import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  AgentDefinition,
  AskUserQuestionPrompt,
  LLMMessage,
  LLMTokenUsage,
  PermissionMode,
  Session,
  SessionCapability,
  SessionId,
  SkillDefinition,
  ToolCall,
  ToolConfirmResult,
  ToolDefinition,
  TranscriptMessage,
  UserTurnInput,
} from "@kako/shared";
import { normalizeUserTurnInput } from "@kako/shared";
import { loadAgent, loadGlobalUserContext, loadSubagentDefinitions, loadWorkspaceKakoMd } from "./loader.js";
import {
  buildMessages,
  buildSystemPromptBase,
  resolveEnvironmentInfo,
} from "./context.js";
import { runAgentLoop, TurnAbortedError, shouldBlockAgentToolAtDepth } from "./loop.js";
import { FileMemoryStore, createMessage } from "../memory/store.js";
import { runCompactionCascade } from "../memory/compact.js";
import { formatPinsForPrompt, loadPins, selectPinsForInject } from "../memory/pins.js";
import { formatFactsExcerpt, listFacts, loadUserProfile } from "../memory/facts.js";
import { runAutoRecall } from "../memory/auto-recall.js";
import { syncSessionToFts } from "../memory/index-fts.js";
import { feedClassifierMilestoneToL1 } from "../memory/detail-bridge.js";
import { resolveModelContextWindow } from "../memory/context-window.js";
import { estimateMessagesTokens, updateTokenEstimateRatio } from "../memory/tokens.js";
import {
  isAutoRecallEnabled,
  loadMemorySettings,
  resolveInjectCaps,
} from "../config/memory-store.js";
import { getFrozenCuratedSnapshot } from "../memory/curated-freeze.js";
import { scheduleBackgroundReview, hasSubstantiveReviewSignal } from "../memory/background-review.js";
import type { MemoryTelemetry } from "@kako/shared";
import { ToolRegistry } from "../tools/registry.js";
import { registerBuiltinTools, resolveAllToolNames, resolveAllowedToolNames } from "../tools/builtin/index.js";
import {
  agentToolDefinition,
  assertSubAgentSpawnAllowed,
  createAgentHandler,
  formatSubAgentResult,
  type AgentToolInput,
} from "../tools/builtin/agent-tool.js";
import { attachmentIncludesDocument, formatAttachmentSystemPromptAddendum } from "../media/attachment-reminders.js";
import { ToolLogger } from "../observability/tool-logger.js";
import { createLLMRouter, resolveModel } from "../llm/router.js";
import { loadProviderRegistry } from "../config/provider-store.js";
import { loadNetworkPolicy } from "../config/network-store.js";
import { defaultSessionCapability, loadSecurityPolicy } from "../security/policy-store.js";
import { formatSecurityPolicySection } from "../security/prompt.js";
import {
  classifySecurityAction,
  formatSecurityTranscriptExcerpt,
} from "../security/action-classifier.js";
import type { ProviderRegistry } from "@kako/shared";
import { mcpManager } from "../mcp/manager.js";
import { sessionManager } from "../session/manager.js";
import { generateJobName } from "../session/job-name.js";
import { generateSessionTitle } from "../session/title.js";
import {
  discoverSkillsForAgent,
  loadSkill,
  partitionSkillsForCatalog,
} from "../skills/loader.js";
import { loadSystemSkills, skillNamesForToolAllowlist } from "../skills/system-skills.js";
import {
  buildInitSkillActivatedMessages,
  buildSkillActivatedMessages,
  formatActiveSkillReminder,
  parseSkillInput,
} from "../tools/builtin/skill.js";
import { beginTurnBudget, getTurnBudget } from "../workflows/budget.js";
import {
  completeBackgroundTask,
  listBackgroundTasks,
  registerBackgroundTask,
} from "../background/task-store.js";
import {
  removeActiveAgentPayload,
  upsertActiveAgentPayload,
} from "../background/agent-persist.js";
import {
  formatBackgroundAgentLaunchResult,
  type AgentTaskRecord,
} from "../background/agent-notification.js";
import { getAgentCompleteHandler } from "../background/agent-completion-registry.js";
import {
  classifySessionState,
  summarizeToolCallsFromTranscript,
} from "../background/session-state-classifier.js";
import { generateJobLabel } from "../background/job-label.js";
import { formatPlanWorkflowReminder } from "./plan-workflow.js";
import { ensurePlanFile } from "../tools/builtin/plan-mode-shared.js";
import { getSessionMemoryDir } from "../config/paths.js";
import { coreDebug, coreDebugError } from "../debug.js";

export interface RunTurnOptions {
  /** Pre-load skill instructions into system-reminder (slash harness path). */
  preactivatedSkill?: {
    name: string;
    instructions: string;
  };
}

export interface AgentRuntimeOptions {
  registry: ProviderRegistry;
  cwd: string;
  agentName?: string;
  askUserQuestion?: AskUserQuestionPrompt;
  confirm?: (toolCall: ToolCall) => Promise<ToolConfirmResult>;
  /**
   * Called before any interactive confirmation / AskUserQuestion for a turn.
   * Host should mark the session Needs input and wait until that session can
   * safely own the TUI overlay (concurrent main-agent turns).
   */
  beforeInteractive?: (sessionId: SessionId) => void | Promise<void>;
  /** Paired with beforeInteractive when the prompt resolves. */
  afterInteractive?: (sessionId: SessionId) => void;
  onTextDelta?: (sessionId: SessionId, text: string) => void;
  onReasoningDelta?: (sessionId: SessionId, text: string) => void;
  onReasoningEnd?: (sessionId: SessionId) => void;
  onStreamUsage?: (sessionId: SessionId, usage: LLMTokenUsage) => void;
  /** Optional memory cascade / auto-recall telemetry (budget/inject caps). */
  onMemoryTelemetry?: (telemetry: MemoryTelemetry) => void;
  onToolStart?: (sessionId: SessionId, name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (
    sessionId: SessionId,
    name: string,
    status: string,
    error?: string,
    output?: string,
    input?: Record<string, unknown>,
  ) => void;
  onAnswerRollback?: (sessionId: SessionId, charCount: number) => void;
  /**
   * Foreground subagent session created — host should start a parked UI turn
   * so Explore detail can stream like a normal agent.
   */
  onSubAgentSessionStart?: (
    parentSessionId: SessionId,
    childSessionId: SessionId,
    userText: string,
  ) => void;
  /** Foreground subagent finished — host should finalize the parked child turn. */
  onSubAgentSessionEnd?: (
    parentSessionId: SessionId,
    childSessionId: SessionId,
  ) => void;
  /**
   * When true, abort this turn. Prefer session-scoped checks so Esc on one
   * chat does not cancel concurrent Agents-spawned turns.
   */
  shouldAbort?: (sessionId: SessionId) => boolean;
}

export interface TurnResult {
  session: Session;
  response: string;
}

const DEFAULT_TITLE = "new session";

function buildUserTurnMetadata(turn: UserTurnInput): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  if (turn.llmText) metadata.llmText = turn.llmText;
  if (turn.llmBlocks?.length) metadata.llmBlocks = turn.llmBlocks;
  if (turn.cliInput) metadata.cliInput = true;
  return Object.keys(metadata).length ? metadata : undefined;
}

/** Empty visible text wake turns (task-notification / stepped-away / last-BG result) still need a classifier ask. */
export function classifierUserAskForTurn(turn: UserTurnInput): string {
  if (turn.text.trim()) return turn.text;
  if (turn.llmText?.includes("<task-notification>")) {
    return "Present the completed background workflow result to the user as a polished report";
  }
  if (turn.llmText?.includes("<stepped-away-recap")) {
    // Align with Claude stepped-away wake: goal + current task + one next action.
    return "Recap the overall goal and current task, then the one next action";
  }
  // Last background agent finished: llmText is plain result (no SYSTEM NOTIFICATION wrapper).
  if (
    turn.llmText?.trim() &&
    !turn.llmText.includes("[SYSTEM NOTIFICATION") &&
    !turn.llmText.includes("<task-notification>")
  ) {
    return "Incorporate the completed background agent findings and continue the task";
  }
  return turn.llmText?.trim() || "";
}

export class AgentRuntime {
  private registry: ProviderRegistry;
  private cwd: string;
  /** Resolved model for the in-flight parent turn; sub-agents inherit from the parent session map. */
  private currentTurnModelBySession = new Map<SessionId, string>();
  private sessionPermissionModeBySession = new Map<SessionId, PermissionMode>();
  private sessionPlanFilePathBySession = new Map<SessionId, string>();
  /** In-flight foreground Agent waits that can be promoted via ctrl+b. */
  private foregroundAgentPromotes = new Map<
    string,
    {
      taskId: string;
      description: string;
      subagentName: string;
      childSessionId?: string;
      resolve: (launchText: string) => void;
      silentFlag: { current: boolean };
    }
  >();
  private askUserQuestion?: AskUserQuestionPrompt;
  /** Last turn transcript-view estimate for usage ratio calibration. */
  private lastEstimateForRatio?: number;
  private lastSessionIdForRatio?: SessionId;
  private callbacks: Pick<
    AgentRuntimeOptions,
    | "confirm"
    | "beforeInteractive"
    | "afterInteractive"
    | "onTextDelta"
    | "onReasoningDelta"
    | "onReasoningEnd"
    | "onStreamUsage"
    | "onMemoryTelemetry"
    | "onToolStart"
    | "onToolEnd"
    | "onAnswerRollback"
    | "onSubAgentSessionStart"
    | "onSubAgentSessionEnd"
    | "shouldAbort"
  >;

  constructor(options: AgentRuntimeOptions) {
    this.registry = options.registry;
    this.cwd = resolve(options.cwd);
    this.askUserQuestion = options.askUserQuestion;
    this.callbacks = {
      confirm: options.confirm,
      beforeInteractive: options.beforeInteractive,
      afterInteractive: options.afterInteractive,
      onTextDelta: options.onTextDelta,
      onReasoningDelta: options.onReasoningDelta,
      onReasoningEnd: options.onReasoningEnd,
      onStreamUsage: options.onStreamUsage,
      onMemoryTelemetry: options.onMemoryTelemetry,
      onToolStart: options.onToolStart,
      onToolEnd: options.onToolEnd,
      onAnswerRollback: options.onAnswerRollback,
      onSubAgentSessionStart: options.onSubAgentSessionStart,
      onSubAgentSessionEnd: options.onSubAgentSessionEnd,
      shouldAbort: options.shouldAbort,
    };
  }

  setCwd(cwd: string): void {
    this.cwd = resolve(cwd);
  }

  getCwd(): string {
    return this.cwd;
  }

  async createSession(agentName = "main"): Promise<Session> {
    return sessionManager.createSession({ cwd: this.cwd, agentName });
  }

  /** Enter chat: reuse empty idle session in cwd when possible. */
  async createOrReuseIdleSession(agentName = "main"): Promise<Session> {
    return sessionManager.createOrReuseIdleSession({ cwd: this.cwd, agentName });
  }

  /**
   * Enter chat after process start: reuse/create empty idle only.
   * Explicit resume stays on Agents / `/resume` / switchChatSession.
   */
  async openChatEntrySession(agentName = "main"): Promise<Session> {
    return sessionManager.openChatEntrySession({ cwd: this.cwd, agentName });
  }

  async resumeSession(sessionId: SessionId): Promise<Session> {
    const session = await sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    this.cwd = resolve(session.cwd);
    // Viewing / switching must not bump updatedAt or flip ended→active; that would
    // reshuffle the Agents list and move completed sessions into Needs input.
    // runTurn reactivates when the user actually sends a message.
    return session;
  }

  /** Re-spawn a background agent from an interrupted checkpoint payload. */
  async resumeBackgroundAgent(session: Session, input: AgentToolInput): Promise<string> {
    const definition = await loadAgent(session.agentName || "main", session.cwd);
    return this.spawnSubAgent(
      session,
      definition,
      { ...input, run_in_background: true },
      `agent-${definition.name}`,
    );
  }

  /**
   * Promote the newest blocking (foreground) agent to background.
   * Returns launch text when promoted; null if nothing to promote.
   */
  promoteForegroundAgent(sessionId: SessionId): string | null {
    const tasks = listBackgroundTasks(sessionId).filter(
      (t) => t.kind === "agent" && !t.stopped && t.blocking,
    );
    const task = tasks[tasks.length - 1];
    if (!task) return null;
    const key = `${sessionId}:${task.id}`;
    const slot = this.foregroundAgentPromotes.get(key);
    if (!slot) return null;

    task.blocking = false;
    slot.silentFlag.current = true;
    const launchText = formatBackgroundAgentLaunchResult({
      taskId: slot.taskId,
      description: slot.description,
      subagentName: slot.subagentName,
      childSessionId: slot.childSessionId ?? task.childSessionId,
    });
    this.foregroundAgentPromotes.delete(key);
    slot.resolve(launchText);
    return launchText;
  }

  /** Persist permission mode across user turns (CLI shift+tab, EnterPlanMode, ExitPlanMode). */
  setSessionPermissionMode(
    sessionId: SessionId,
    mode: PermissionMode,
    planFilePath?: string,
  ): void {
    this.sessionPermissionModeBySession.set(sessionId, mode);
    if (planFilePath !== undefined) {
      this.sessionPlanFilePathBySession.set(sessionId, planFilePath);
    }
    if (mode !== "plan") {
      this.sessionPlanFilePathBySession.delete(sessionId);
    }
  }

  getSessionPermissionMode(sessionId: SessionId): PermissionMode {
    return this.sessionPermissionModeBySession.get(sessionId) ?? "default";
  }

  async runTurn(
    session: Session,
    userInput: string | UserTurnInput,
    options?: RunTurnOptions,
  ): Promise<TurnResult> {
    // Reload so Web UI / providers.json changes apply without restarting CLI.
    this.registry = await loadProviderRegistry();

    const definition = await loadAgent(session.agentName, session.cwd);
    const memory = new FileMemoryStore(session.id);
    const logger = new ToolLogger();

    const turn = normalizeUserTurnInput(userInput);

    beginTurnBudget(session.id, turn.text);

    coreDebug("runtime:runTurn:start", {
      sessionId: session.id,
      agentName: session.agentName,
      textLen: turn.text.length,
      cliInput: turn.cliInput === true,
      hasLlmText: Boolean(turn.llmText),
    });

    await memory.append(
      createMessage("user", turn.text, {
        attachments: turn.attachments,
        metadata: buildUserTurnMetadata(turn),
      }),
    );

    await sessionManager.updateSession(session.id, {
      status: "active",
      agentState: {
        state: "working",
        detail: "running turn",
        tempo: "active",
        since: new Date().toISOString(),
      },
    });

    const router = createLLMRouter(this.registry);
    const model = await resolveModel(definition.model, this.registry);
    this.currentTurnModelBySession.set(session.id, model);

    const meta = await sessionManager.getSessionMeta(session.id);
    const securityPolicy = await loadSecurityPolicy(session.cwd);
    const networkPolicy = await loadNetworkPolicy();
    const capability = defaultSessionCapability(securityPolicy);
    const securityPolicySection = formatSecurityPolicySection(
      securityPolicy,
      networkPolicy,
      capability,
    );

    if (meta?.title === DEFAULT_TITLE && turn.text.trim()) {
      void generateSessionTitle(router, model, turn.text)
        .then(async (title) => {
          if (!title) return;
          await sessionManager.updateSession(session.id, { title });
        })
        .catch((err) => {
          coreDebugError("runtime:title-update-failed", {
            sessionId: session.id,
            err: err instanceof Error ? err.message : String(err),
          });
        });
    }

    if (!meta?.jobName && turn.text.trim()) {
      void generateJobName(router, model, turn.text)
        .then(async (jobName) => {
          if (!jobName) return;
          await sessionManager.updateSession(session.id, { jobName });
        })
        .catch((err) => {
          coreDebugError("runtime:jobName-update-failed", {
            sessionId: session.id,
            err: err instanceof Error ? err.message : String(err),
          });
        });
    }

    const workspaceKako = await loadWorkspaceKakoMd(session.cwd);
    const globalContext = await loadGlobalUserContext();
    const environment = await resolveEnvironmentInfo(session.cwd, model);
    const transcript = await memory.loadTranscript();

    const memorySettings = await loadMemorySettings();
    const injectCaps = resolveInjectCaps(memorySettings);
    const contextWindow = resolveModelContextWindow(this.registry, model);
    const sessionMeta = await sessionManager.getSessionMeta(session.id);

    const cascade = await runCompactionCascade({
      sessionId: session.id,
      transcript,
      router,
      model,
      contextWindow,
      caps: injectCaps,
      memoryCompact: sessionMeta?.memoryCompact,
      tokenEstimateRatio: sessionMeta?.memoryCompact?.tokenEstimateRatio,
    });
    if (cascade.memoryCompact) {
      await sessionManager
        .updateSession(session.id, { memoryCompact: cascade.memoryCompact })
        .catch(() => {});
    }
    void syncSessionToFts(session.id).catch(() => {
      /* FTS sync is best-effort */
    });

    const pinsSection = formatPinsForPrompt(
      selectPinsForInject(await loadPins(session.id), injectCaps),
    );
    const userProfile = await loadUserProfile();
    const factsExcerpt = formatFactsExcerpt(await listFacts(), injectCaps);
    const curatedSnapshot = await getFrozenCuratedSnapshot(session.id, memorySettings);
    const autoRecallEnabled = isAutoRecallEnabled(memorySettings);
    const autoRecall = runAutoRecall({
      query: turn.text,
      sessionId: session.id,
      enabled: autoRecallEnabled,
      caps: injectCaps,
    });

    this.callbacks.onMemoryTelemetry?.({
      tierApplied: cascade.result.tierApplied,
      estimatedTokensBefore: cascade.result.estimatedTokensBefore,
      estimatedTokensAfter: cascade.result.estimatedTokensAfter,
      injectedSnippets: autoRecall.injectedSnippets,
      injectedTokens: autoRecall.injectedTokens,
      flushed: cascade.result.flush?.flushed,
      autoRecallEnabled,
    });

    // Capture estimated message size for usage ratio update after the turn.
    this.lastEstimateForRatio = estimateMessagesTokens(cascade.viewTranscript);
    this.lastSessionIdForRatio = session.id;

    const sessionSummary =
      cascade.sessionSummary ??
      (transcript.length > 0
        ? await sessionManager.loadSessionSummary(session.id)
        : undefined);
    const discoveredSkills = await discoverSkillsForAgent(session.cwd);
    const skillCatalog = await partitionSkillsForCatalog(session.cwd);

    const subagentDefinitions = await loadSubagentDefinitions(
      definition.subagents,
      session.cwd,
    );

    const toolRegistry = await this.createToolRegistry(
      session,
      definition,
      options,
      discoveredSkills,
      capability,
    );
    // Top-level agent: expose every registered tool (built-ins, MCP, Agent, etc.) on each LLM call.
    const allowedTools = resolveAllToolNames(toolRegistry);

    const messages = await buildMessages({
      definition,
      transcript: cascade.viewTranscript,
      workspaceKakoMd: workspaceKako?.content,
      globalContext: globalContext?.content,
      sessionSummary,
      curatedSnapshot,
      userProfile,
      factsExcerpt: factsExcerpt || undefined,
      pinsSection: pinsSection || undefined,
      // Auto-recall only — never agentState.detail / DetailLog.
      retrievedContext: autoRecall.formatted || undefined,
      availableSkills: skillCatalog,
      environment,
      subagentDefinitions,
      securityPolicySection,
      capability,
    });

    if (attachmentIncludesDocument(turn.attachments) && typeof messages[0]?.content === "string") {
      messages[0].content += formatAttachmentSystemPromptAddendum();
    }

    if (options?.preactivatedSkill) {
      const systemMsg = messages[0];
      if (systemMsg?.role === "system" && typeof systemMsg.content === "string") {
        systemMsg.content += formatActiveSkillReminder(
          options.preactivatedSkill.name,
          options.preactivatedSkill.instructions,
        );
      }
    }

    const permissionMode =
      this.sessionPermissionModeBySession.get(session.id) ??
      definition.permissionMode ??
      "default";
    if (permissionMode === "plan") {
      const planPath =
        this.sessionPlanFilePathBySession.get(session.id) ??
        (await ensurePlanFile(session.id));
      this.sessionPlanFilePathBySession.set(session.id, planPath);
      const systemMsg = messages[0];
      if (systemMsg?.role === "system" && typeof systemMsg.content === "string") {
        systemMsg.content += await formatPlanWorkflowReminder(planPath);
      }
    }

    const responseText = await runAgentLoop({
      router,
      registry: toolRegistry,
      toolLogger: logger,
      memory,
      messages,
      allowedTools,
      model,
      maxTurns: definition.maxTurns ?? 20,
      callbacks: this.userFacingCallbacks(session.id),
      shouldAbort: () => this.callbacks.shouldAbort?.(session.id) === true,
      onSkillActivate: async ({ toolCall }) => {
        const parsed = parseSkillInput(toolCall.input);
        const transcript = await memory.loadTranscript();
        const dialog = transcript.filter(
          (msg) => msg.role === "user" || msg.role === "assistant",
        );
        const systemPromptBase = buildSystemPromptBase(definition, {
          globalContext: globalContext?.content,
          sessionSummary,
          environment,
          subagentDefinitions,
        });
        if (parsed.skill === "init") {
          return buildInitSkillActivatedMessages({
            systemPromptBase,
            transcript: dialog,
            skillArgs: parsed.args,
            workspaceKakoMd: workspaceKako?.content,
          });
        }
        // Status-only system skills (e.g. workflows) have no SKILL.md body — the Skill
        // tool result already carries the answer; do not pivot / loadSkill (that throws).
        const systemSkills = await loadSystemSkills();
        const systemSkill = systemSkills.find((s) => s.name === parsed.skill);
        if (systemSkill && !systemSkill.skillMdPath) {
          return;
        }
        const loaded = await loadSkill(parsed.skill, session.cwd);
        if (parsed.args?.trim()) {
          await memory.append(
            createMessage("user", parsed.args.trim(), {
              metadata: { harnessInjected: true },
            }),
          );
        }
        return buildSkillActivatedMessages({
          systemPromptBase,
          transcript: dialog,
          skillName: loaded.name,
          skillInstructions: loaded.instructions,
          skillArgs: parsed.args,
          workspaceKakoMd: workspaceKako?.content,
        });
      },
    });

    if (responseText) {
      await memory.append(createMessage("assistant", responseText));
    }

    session.updatedAt = new Date().toISOString();
    await sessionManager.updateSession(session.id, { status: "active" });

    if (
      hasSubstantiveReviewSignal({
        userTurnText: turn.text,
        assistantResponseText: responseText,
        hasUserAttachments: (turn.attachments?.length ?? 0) > 0,
      })
    ) {
      void memory.loadTranscript().then((full) => {
        scheduleBackgroundReview(
          {
            sessionId: session.id,
            transcript: full,
            router,
            mainModel: model,
            settings: memorySettings,
            registry: this.registry,
            userTurnText: turn.text,
            assistantResponseText: responseText,
            hasUserAttachments: (turn.attachments?.length ?? 0) > 0,
          },
          (result) => {
            this.callbacks.onMemoryTelemetry?.({
              tierApplied: null,
              backgroundReviewRan: result.ran,
              skippedReason: result.skippedReason,
              jobName: "backgroundReview",
            });
          },
        );
      }).catch(() => {});
    }

    void this.postTurnMetadata(
      session,
      classifierUserAskForTurn(turn),
      responseText,
      transcript,
      model,
      router,
    );

    coreDebug("runtime:runTurn:done", {
      sessionId: session.id,
      responseLen: responseText.length,
    });
    return { session, response: responseText };
  }

  private async postTurnMetadata(
    session: Session,
    userAsk: string,
    responseText: string,
    transcriptBefore: TranscriptMessage[],
    model: string,
    router: ReturnType<typeof createLLMRouter>,
  ): Promise<void> {
    const bgTasks = listBackgroundTasks(session.id).filter((t) => !t.stopped);
    const hasBackgroundWork = bgTasks.some((t) => t.kind === "agent" || t.kind === "workflow");
    const meta = await sessionManager.getSessionMeta(session.id);
    const wasWorking = meta?.agentState?.state === "working";
    if (!hasBackgroundWork && !responseText.trim() && !wasWorking) return;

    const updatedTranscript = [...transcriptBefore];
    if (responseText) {
      updatedTranscript.push(createMessage("assistant", responseText));
    }
    const toolNames = updatedTranscript
      .filter((m) => m.role === "tool")
      .map((m) => {
        const toolMeta = m.metadata as { toolName?: string } | undefined;
        return toolMeta?.toolName ?? m.toolName ?? "tool";
      });

    try {
      const classified = await classifySessionState(router, model, {
        previousState: meta?.agentState,
        userAsk,
        assistantTail: responseText,
        toolSummary: summarizeToolCallsFromTranscript(toolNames),
      });
      if (classified) {
        // Contract: in-flight agent/workflow background work ⇒ working (not done).
        const state =
          hasBackgroundWork && classified.state === "done" ? "working" : classified.state;
        await sessionManager.updateSession(session.id, {
          agentState: {
            state,
            detail: classified.detail,
            tempo: state === "working" ? "active" : classified.tempo,
            needs: state === "blocked" ? classified.needs : undefined,
            result: state === "done" ? classified.result : undefined,
            since: new Date().toISOString(),
          },
        });
        // Bidirectional: classifier milestone → L1; UI detail never enters RAG.
        void feedClassifierMilestoneToL1(session.id, {
          state,
          detail: classified.detail,
        }).catch(() => {});
      } else if (hasBackgroundWork) {
        await sessionManager.updateSession(session.id, {
          agentState: {
            state: "working",
            detail: responseText.trim().slice(0, 120) || "background work running",
            tempo: "active",
            since: new Date().toISOString(),
          },
        });
      } else if (wasWorking) {
        await sessionManager.updateSession(session.id, {
          agentState: {
            state: "done",
            detail: responseText.trim().slice(0, 120) || "turn finished",
            tempo: "idle",
            since: new Date().toISOString(),
          },
        });
      }
    } catch {
      if (hasBackgroundWork) {
        await sessionManager
          .updateSession(session.id, {
            agentState: {
              state: "working",
              detail: "background work running",
              tempo: "active",
              since: new Date().toISOString(),
            },
          })
          .catch(() => {});
      } else if (wasWorking) {
        await sessionManager
          .updateSession(session.id, {
            agentState: {
              state: "done",
              detail: "turn finished",
              tempo: "idle",
              since: new Date().toISOString(),
            },
          })
          .catch(() => {});
      }
    }

    if (!meta?.jobLabel && responseText.trim().length > 20) {
      void generateJobLabel(router, model, userAsk, responseText)
        .then(async (label) => {
          if (!label) return;
          await sessionManager.updateSession(session.id, { jobLabel: label });
        })
        .catch((err) => {
          coreDebugError("runtime:jobLabel-update-failed", {
            sessionId: session.id,
            err: err instanceof Error ? err.message : String(err),
          });
        });
    }
  }

  async endSession(session: Session): Promise<void> {
    await sessionManager.endSession(session.id);
    session.status = "ended";
    session.updatedAt = new Date().toISOString();
  }

  private userFacingCallbacks(sessionId: SessionId) {
    return {
      onTextDelta: (text: string) => this.callbacks.onTextDelta?.(sessionId, text),
      onReasoningDelta: (text: string) => this.callbacks.onReasoningDelta?.(sessionId, text),
      onReasoningEnd: () => this.callbacks.onReasoningEnd?.(sessionId),
      onStreamUsage: (usage: LLMTokenUsage) => {
        getTurnBudget(sessionId)?.recordOutputTokens(usage.outputTokens);
        if (
          usage.inputTokens > 0 &&
          this.lastEstimateForRatio &&
          this.lastSessionIdForRatio === sessionId
        ) {
          void sessionManager.getSessionMeta(sessionId).then(async (m) => {
            const prev = m?.memoryCompact?.tokenEstimateRatio;
            const next = updateTokenEstimateRatio(
              prev,
              this.lastEstimateForRatio!,
              usage.inputTokens,
            );
            const memoryCompact = {
              ...(m?.memoryCompact ?? { generation: 0 }),
              generation: m?.memoryCompact?.generation ?? 0,
              tokenEstimateRatio: next,
            };
            await sessionManager.updateSession(sessionId, { memoryCompact });
          }).catch(() => {});
        }
        this.callbacks.onStreamUsage?.(sessionId, usage);
      },
      onToolStart: (name: string, input: Record<string, unknown>) =>
        this.callbacks.onToolStart?.(sessionId, name, input),
      onToolEnd: (
        name: string,
        status: string,
        error?: string,
        output?: string,
        input?: Record<string, unknown>,
      ) => this.callbacks.onToolEnd?.(sessionId, name, status, error, output, input),
      onAnswerRollback: (charCount: number) =>
        this.callbacks.onAnswerRollback?.(sessionId, charCount),
    };
  }

  private async createToolRegistry(
    session: Session,
    definition: AgentDefinition,
    options?: RunTurnOptions,
    agentSkills: SkillDefinition[] = [],
    capability?: SessionCapability,
  ): Promise<ToolRegistry> {
    const agentId = `agent-${definition.name}`;
    const askUserQuestion = this.askUserQuestion
      ? async (input: Parameters<NonNullable<AskUserQuestionPrompt>>[0]) => {
          await this.callbacks.beforeInteractive?.(session.id);
          try {
            return await this.askUserQuestion!(input);
          } finally {
            this.callbacks.afterInteractive?.(session.id);
          }
        }
      : undefined;
    const confirm = this.callbacks.confirm
      ? async (toolCall: ToolCall) => {
          await this.callbacks.beforeInteractive?.(session.id);
          try {
            return await this.callbacks.confirm!(toolCall);
          } finally {
            this.callbacks.afterInteractive?.(session.id);
          }
        }
      : undefined;
    const permissionMode =
      this.sessionPermissionModeBySession.get(session.id) ?? definition.permissionMode;
    const classifyAction =
      permissionMode === "bypassPermissions"
        ? async (toolCall: ToolCall, _definition: ToolDefinition) => {
            try {
              const memory = new FileMemoryStore(session.id);
              const transcript = await memory.loadTranscript();
              const recentLines = transcript.slice(-24).map((msg) => {
                if (msg.role === "user") return `{"user":${JSON.stringify(msg.content.slice(0, 500))}}`;
                if (msg.role === "assistant") {
                  return `{"assistant":${JSON.stringify(msg.content.slice(0, 500))}}`;
                }
                if (msg.role === "tool") {
                  const name = msg.toolName ?? "tool";
                  return `{"${name}":${JSON.stringify(String(msg.content).slice(0, 400))}}`;
                }
                return "";
              }).filter(Boolean);
              const transcriptText = formatSecurityTranscriptExcerpt({
                recentLines,
                toolName: toolCall.name,
                toolInput: toolCall.input,
              });
              const model = this.currentTurnModelBySession.get(session.id) ??
                (await resolveModel(definition.model, this.registry));
              const router = createLLMRouter(this.registry);
              return await classifySecurityAction({
                router,
                model,
                transcriptText,
                userIdentity: process.env.USER,
              });
            } catch {
              return {
                shouldBlock: true,
                reason: "Security classifier unavailable (fail-closed)",
              };
            }
          }
        : undefined;
    const registry = new ToolRegistry({
      cwd: session.cwd,
      sessionId: session.id,
      agentId,
      permissionMode,
      capability,
      confirm,
      askUserQuestion,
      allowedSkills: skillNamesForToolAllowlist(agentSkills),
      planFilePath: this.sessionPlanFilePathBySession.get(session.id),
      initialActivatedSkills: options?.preactivatedSkill
        ? [options.preactivatedSkill.name]
        : undefined,
      classifyAction,
    });
    registerBuiltinTools(registry);
    await mcpManager.registerTo((def, handler) => registry.register(def, handler));

    registry.register(
      agentToolDefinition,
      createAgentHandler({
        spawnSubAgent: (input, context) =>
          this.spawnSubAgent(session, definition, input, context.agentId, {
            agentDepth: 0,
            toolCallId: context.toolUseId,
          }),
      }),
    );

    return registry;
  }

  private async spawnSubAgent(
    session: Session,
    parentDefinition: AgentDefinition,
    input: AgentToolInput,
    parentAgentId: string,
    opts?: { agentDepth?: number; toolCallId?: string },
  ): Promise<string> {
    const subagentName = assertSubAgentSpawnAllowed(input, parentDefinition.subagents ?? []);
    const agentDepth = opts?.agentDepth ?? 0;

    if (input.run_in_background) {
      return this.spawnSubAgentInBackground(
        session,
        parentDefinition,
        input,
        parentAgentId,
        subagentName,
        agentDepth,
        opts?.toolCallId,
      );
    }

    return this.spawnSubAgentInForeground(
      session,
      parentDefinition,
      input,
      parentAgentId,
      subagentName,
      agentDepth,
      opts?.toolCallId,
    );
  }

  private async spawnSubAgentInForeground(
    session: Session,
    parentDefinition: AgentDefinition,
    input: AgentToolInput,
    parentAgentId: string,
    subagentName: string,
    parentDepth: number,
    toolCallId?: string,
  ): Promise<string> {
    const taskId = `a${randomBytes(4).toString("hex")}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();
    const silentFlag = { current: false };
    let childSessionId: string | undefined;
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;
    let promoteResolve: ((launchText: string) => void) | undefined;
    const promoteGate = new Promise<string>((resolve) => {
      promoteResolve = resolve;
    });

    registerBackgroundTask(
      session.id,
      taskId,
      "agent",
      async () => {
        abortController.abort();
      },
      {
        description: input.description,
        subagentName,
        blocking: true,
      },
    );

    void upsertActiveAgentPayload(session.id, {
      taskId,
      description: input.description,
      prompt: input.prompt,
      subagentName,
      startedAt,
    }).catch(() => {});

    const slotKey = `${session.id}:${taskId}`;
    this.foregroundAgentPromotes.set(slotKey, {
      taskId,
      description: input.description,
      subagentName,
      resolve: (launchText) => promoteResolve?.(launchText),
      silentFlag,
    });

    const run = this.executeSubAgentRun({
      session,
      parentDefinition,
      input,
      parentAgentId,
      subagentName,
      agentDepth: parentDepth + 1,
      shouldAbort: () =>
        abortController.signal.aborted || this.callbacks.shouldAbort?.(session.id) === true,
      silentTools: silentFlag,
      onChildSession: (childId) => {
        childSessionId = childId;
        const task = listBackgroundTasks(session.id).find((t) => t.id === taskId);
        if (task) task.childSessionId = childId;
        const slot = this.foregroundAgentPromotes.get(slotKey);
        if (slot) slot.childSessionId = childId;
        void upsertActiveAgentPayload(session.id, {
          taskId,
          description: input.description,
          prompt: input.prompt,
          subagentName,
          startedAt,
          childSessionId: childId,
        }).catch(() => {});
      },
      onUsage: (u) => {
        usage = {
          inputTokens: (usage?.inputTokens ?? 0) + u.inputTokens,
          outputTokens: (usage?.outputTokens ?? 0) + u.outputTokens,
          totalTokens: (usage?.totalTokens ?? 0) + u.totalTokens,
        };
      },
    });

    type RaceResult =
      | { kind: "done"; text: string }
      | { kind: "promoted"; launch: string }
      | { kind: "error"; err: unknown };

    const raced = await Promise.race([
      run.then(
        (text): RaceResult => ({ kind: "done", text }),
        (err): RaceResult => ({ kind: "error", err }),
      ),
      promoteGate.then((launch): RaceResult => ({ kind: "promoted", launch })),
    ]);

    if (raced.kind === "promoted") {
      void run
        .then((result) => {
          const outputFile = childSessionId
            ? `${getSessionMemoryDir(childSessionId)}/transcript.jsonl`
            : undefined;
          const otherBackgroundAgentsRunning = listBackgroundTasks(session.id).some(
            (t) => t.kind === "agent" && !t.stopped && t.id !== taskId,
          );
          void this.notifyAgentComplete(session.id, {
            taskId,
            toolCallId,
            subagentName,
            description: input.description,
            status: "completed",
            startedAt,
            completedAt: new Date().toISOString(),
            result,
            outputFile,
            usage,
            otherBackgroundAgentsRunning,
          });
        })
        .catch((err) => {
          const stopped =
            abortController.signal.aborted || err instanceof TurnAbortedError;
          const outputFile = childSessionId
            ? `${getSessionMemoryDir(childSessionId)}/transcript.jsonl`
            : undefined;
          const otherBackgroundAgentsRunning = listBackgroundTasks(session.id).some(
            (t) => t.kind === "agent" && !t.stopped && t.id !== taskId,
          );
          void this.notifyAgentComplete(session.id, {
            taskId,
            toolCallId,
            subagentName,
            description: input.description,
            status: stopped ? "stopped" : "error",
            startedAt,
            completedAt: new Date().toISOString(),
            error: stopped
              ? "Stopped by user"
              : err instanceof Error
                ? err.message
                : String(err),
            outputFile,
            usage,
            otherBackgroundAgentsRunning,
          });
        })
        .finally(() => {
          completeBackgroundTask(session.id, taskId);
          void removeActiveAgentPayload(session.id, taskId).catch(() => {});
        });
      return raced.launch;
    }

    this.foregroundAgentPromotes.delete(slotKey);
    completeBackgroundTask(session.id, taskId);
    void removeActiveAgentPayload(session.id, taskId).catch(() => {});
    if (raced.kind === "error") throw raced.err;
    return raced.text;
  }

  private spawnSubAgentInBackground(
    session: Session,
    parentDefinition: AgentDefinition,
    input: AgentToolInput,
    parentAgentId: string,
    subagentName: string,
    parentDepth: number,
    toolCallId?: string,
  ): string {
    const taskId = `a${randomBytes(4).toString("hex")}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();
    let childSessionId: string | undefined;
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

    registerBackgroundTask(
      session.id,
      taskId,
      "agent",
      async () => {
        abortController.abort();
      },
      {
        description: input.description,
        subagentName,
      },
    );

    void upsertActiveAgentPayload(session.id, {
      taskId,
      description: input.description,
      prompt: input.prompt,
      subagentName,
      startedAt,
    }).catch(() => {});

    void sessionManager
      .updateSession(session.id, {
        agentState: {
          state: "working",
          detail: input.description.trim().slice(0, 120) || "background agent running",
          tempo: "active",
          since: new Date().toISOString(),
        },
      })
      .catch(() => {});

    void this.executeSubAgentRun({
      session,
      parentDefinition,
      input,
      parentAgentId,
      subagentName,
      agentDepth: parentDepth + 1,
      shouldAbort: () =>
        abortController.signal.aborted || this.callbacks.shouldAbort?.(session.id) === true,
      silentTools: true,
      onChildSession: (childId) => {
        childSessionId = childId;
        const task = listBackgroundTasks(session.id).find((t) => t.id === taskId);
        if (task) {
          task.childSessionId = childId;
        }
        void upsertActiveAgentPayload(session.id, {
          taskId,
          description: input.description,
          prompt: input.prompt,
          subagentName,
          startedAt,
          childSessionId: childId,
        }).catch(() => {});
      },
      onUsage: (u) => {
        usage = {
          inputTokens: (usage?.inputTokens ?? 0) + u.inputTokens,
          outputTokens: (usage?.outputTokens ?? 0) + u.outputTokens,
          totalTokens: (usage?.totalTokens ?? 0) + u.totalTokens,
        };
      },
    })
      .then((result) => {
        const outputFile = childSessionId
          ? `${getSessionMemoryDir(childSessionId)}/transcript.jsonl`
          : undefined;
        // Count siblings before this task is removed in finally.
        const otherBackgroundAgentsRunning = listBackgroundTasks(session.id).some(
          (t) => t.kind === "agent" && !t.stopped && t.id !== taskId,
        );
        void this.notifyAgentComplete(session.id, {
          taskId,
          toolCallId,
          subagentName,
          description: input.description,
          status: "completed",
          startedAt,
          completedAt: new Date().toISOString(),
          result,
          outputFile,
          usage,
          otherBackgroundAgentsRunning,
        });
      })
      .catch((err) => {
        const stopped =
          abortController.signal.aborted || err instanceof TurnAbortedError;
        const outputFile = childSessionId
          ? `${getSessionMemoryDir(childSessionId)}/transcript.jsonl`
          : undefined;
        const otherBackgroundAgentsRunning = listBackgroundTasks(session.id).some(
          (t) => t.kind === "agent" && !t.stopped && t.id !== taskId,
        );
        void this.notifyAgentComplete(session.id, {
          taskId,
          toolCallId,
          subagentName,
          description: input.description,
          status: stopped ? "stopped" : "error",
          startedAt,
          completedAt: new Date().toISOString(),
          error: stopped
            ? "Stopped by user"
            : err instanceof Error
              ? err.message
              : String(err),
          outputFile,
          usage,
          otherBackgroundAgentsRunning,
        });
      })
      .finally(() => {
        completeBackgroundTask(session.id, taskId);
        void removeActiveAgentPayload(session.id, taskId).catch(() => {});
      });

    return formatBackgroundAgentLaunchResult({
      taskId,
      description: input.description,
      subagentName,
      childSessionId,
    });
  }

  private async notifyAgentComplete(sessionId: string, record: AgentTaskRecord): Promise<void> {
    const handler = getAgentCompleteHandler(sessionId);
    if (!handler) return;
    try {
      await handler(record);
    } catch {
      // UI notification failures should not crash the runner.
    }
  }

  private async executeSubAgentRun(input: {
    session: Session;
    parentDefinition: AgentDefinition;
    input: AgentToolInput;
    parentAgentId: string;
    subagentName: string;
    /** Depth of the child agent (main=0 → first child=1). */
    agentDepth: number;
    shouldAbort?: () => boolean;
    silentTools?: boolean | { current: boolean };
    onChildSession?: (childSessionId: SessionId) => void;
    onUsage?: (usage: LLMTokenUsage) => void;
  }): Promise<string> {
    const { session, parentDefinition, subagentName, input: agentInput, agentDepth } = input;
    const isSilent = (): boolean => {
      const flag = input.silentTools;
      if (flag && typeof flag === "object") return flag.current;
      return Boolean(flag);
    };
    const subDefinition = await loadAgent(subagentName, session.cwd);
    const childSession = await sessionManager.createChildSession({
      parentSessionId: session.id,
      agentName: subagentName,
      cwd: session.cwd,
    });
    input.onChildSession?.(childSession.id);

    const memory = new FileMemoryStore(childSession.id);
    await memory.append(createMessage("user", agentInput.prompt));

    const logger = new ToolLogger();
    const router = createLLMRouter(this.registry);

    const parentModel =
      this.currentTurnModelBySession.get(session.id) ??
      (await resolveModel(parentDefinition.model, this.registry));

    // Inherit parent model unless caller explicitly passes model.
    const model = agentInput.model?.trim()
      ? await resolveModel(agentInput.model, this.registry)
      : parentModel;

    const workspaceKako = await loadWorkspaceKakoMd(session.cwd);
    const globalContext = await loadGlobalUserContext();
    const environment = await resolveEnvironmentInfo(session.cwd, model);
    const subSkills = await discoverSkillsForAgent(session.cwd);
    const subSkillCatalog = await partitionSkillsForCatalog(session.cwd);
    const nestParentDefinition: AgentDefinition = {
      ...subDefinition,
      subagents:
        subDefinition.subagents?.length
          ? subDefinition.subagents
          : parentDefinition.subagents,
    };
    const messages = await buildMessages({
      definition: subDefinition,
      transcript: [createMessage("user", agentInput.prompt)],
      workspaceKakoMd: workspaceKako?.content,
      globalContext: globalContext?.content,
      availableSkills: subSkillCatalog,
      environment,
      subagentDefinitions: nestParentDefinition.subagents?.length
        ? await loadSubagentDefinitions(nestParentDefinition.subagents, session.cwd)
        : undefined,
    });

    const subRegistry = new ToolRegistry({
      cwd: session.cwd,
      sessionId: childSession.id,
      agentId: `${input.parentAgentId}/${subagentName}`,
      permissionMode: subDefinition.permissionMode,
      confirm: this.callbacks.confirm
        ? async (toolCall: ToolCall) => {
            await this.callbacks.beforeInteractive?.(session.id);
            try {
              return await this.callbacks.confirm!(toolCall);
            } finally {
              this.callbacks.afterInteractive?.(session.id);
            }
          }
        : undefined,
      askUserQuestion: this.askUserQuestion
        ? async (askInput: Parameters<NonNullable<AskUserQuestionPrompt>>[0]) => {
            await this.callbacks.beforeInteractive?.(session.id);
            try {
              return await this.askUserQuestion!(askInput);
            } finally {
              this.callbacks.afterInteractive?.(session.id);
            }
          }
        : undefined,
      allowedSkills: skillNamesForToolAllowlist(subSkills),
    });
    registerBuiltinTools(subRegistry);
    await mcpManager.registerTo((def, handler) => subRegistry.register(def, handler));

    const blockAgent = shouldBlockAgentToolAtDepth(agentDepth);
    if (!blockAgent) {
      subRegistry.register(
        agentToolDefinition,
        createAgentHandler({
          spawnSubAgent: (nestedInput, context) =>
            this.spawnSubAgent(
              childSession,
              nestParentDefinition,
              nestedInput,
              `${input.parentAgentId}/${subagentName}`,
              {
                agentDepth,
                toolCallId: context.toolUseId,
              },
            ),
        }),
      );
    }

    // Sub-agent: only tools declared in its agent YAML (no automatic full MCP surface).
    const allowedTools = resolveAllowedToolNames(subDefinition.tools, subRegistry, {
      disallowedTools: subDefinition.disallowedTools,
      excludeAgent: blockAgent,
    });

    // Capture silence at start — ctrl+b may flip silent mid-run; still end the UI turn.
    const childUiLive = !isSilent();
    if (childUiLive) {
      this.callbacks.onSubAgentSessionStart?.(
        session.id,
        childSession.id,
        agentInput.prompt,
      );
    }

    try {
      const responseText = await runAgentLoop({
        router,
        registry: subRegistry,
        toolLogger: logger,
        memory,
        messages,
        allowedTools,
        model,
        maxTurns: subDefinition.maxTurns ?? 20,
        blockAgentTool: blockAgent,
        shouldAbort:
          input.shouldAbort ?? (() => this.callbacks.shouldAbort?.(session.id) === true),
        callbacks: childUiLive
          ? {
              // Child session owns a normal agent timeline (detail / parked shell).
              // Tools are also mirrored to the parent so main can nest under Agent.
              onStreamUsage: (usage) => input.onUsage?.(usage),
              onTextDelta: (text) => {
                if (isSilent()) return;
                this.callbacks.onTextDelta?.(childSession.id, text);
              },
              onReasoningDelta: (text) => {
                if (isSilent()) return;
                this.callbacks.onReasoningDelta?.(childSession.id, text);
              },
              onReasoningEnd: () => {
                if (isSilent()) return;
                this.callbacks.onReasoningEnd?.(childSession.id);
              },
              onAnswerRollback: (charCount) => {
                if (isSilent()) return;
                this.callbacks.onAnswerRollback?.(childSession.id, charCount);
              },
              onToolStart: (name, toolInput) => {
                if (isSilent()) return;
                this.callbacks.onToolStart?.(childSession.id, name, toolInput);
                this.callbacks.onToolStart?.(session.id, name, toolInput);
              },
              onToolEnd: (name, status, error, output, toolInput) => {
                if (isSilent()) return;
                this.callbacks.onToolEnd?.(
                  childSession.id,
                  name,
                  status,
                  error,
                  output,
                  toolInput,
                );
                this.callbacks.onToolEnd?.(
                  session.id,
                  name,
                  status,
                  error,
                  output,
                  toolInput,
                );
              },
            }
          : {
              onStreamUsage: (usage) => input.onUsage?.(usage),
            },
      });

      if (responseText) {
        await memory.append(createMessage("assistant", responseText));
      }

      return formatSubAgentResult(subagentName, agentInput.description, responseText);
    } finally {
      if (childUiLive) {
        this.callbacks.onSubAgentSessionEnd?.(session.id, childSession.id);
      }
    }
  }
}
