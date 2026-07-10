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
  UserTurnInput,
} from "@kako/shared";
import { normalizeUserTurnInput } from "@kako/shared";
import { loadAgent, loadGlobalUserContext, loadSubagentDefinitions, loadWorkspaceKakoMd } from "./loader.js";
import {
  buildMessages,
  buildSystemPromptBase,
  resolveEnvironmentInfo,
} from "./context.js";
import { runAgentLoop, TurnAbortedError } from "./loop.js";
import { FileMemoryStore, createMessage } from "../memory/store.js";
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
import type { ProviderRegistry } from "@kako/shared";
import { mcpManager } from "../mcp/manager.js";
import { sessionManager } from "../session/manager.js";
import { generateSessionTitle } from "../session/title.js";
import {
  discoverSkillsForAgent,
  loadSkill,
  toSkillIndex,
} from "../skills/loader.js";
import { skillNamesForToolAllowlist } from "../skills/system-skills.js";
import {
  buildSkillActivatedMessages,
  formatActiveSkillReminder,
  parseSkillInput,
} from "../tools/builtin/skill.js";
import { beginTurnBudget, getTurnBudget } from "../workflows/budget.js";
import {
  completeBackgroundTask,
  registerBackgroundTask,
} from "../background/task-store.js";
import {
  formatBackgroundAgentLaunchResult,
  type AgentTaskRecord,
} from "../background/agent-notification.js";
import { getAgentCompleteHandler } from "../background/agent-completion-registry.js";

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
  onTextDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  onReasoningEnd?: () => void;
  onStreamUsage?: (usage: LLMTokenUsage) => void;
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, status: string, error?: string, output?: string, input?: Record<string, unknown>) => void;
  onAnswerRollback?: (charCount: number) => void;
  /** When true, abort the current turn (e.g. Ctrl+C during streaming). */
  shouldAbort?: () => boolean;
}

export interface TurnResult {
  session: Session;
  response: string;
}

const DEFAULT_TITLE = "New chat";

function buildUserTurnMetadata(turn: UserTurnInput): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  if (turn.llmText) metadata.llmText = turn.llmText;
  if (turn.cliInput) metadata.cliInput = true;
  return Object.keys(metadata).length ? metadata : undefined;
}

export class AgentRuntime {
  private registry: ProviderRegistry;
  private cwd: string;
  /** Resolved model for the in-flight parent turn; sub-agents inherit this by default. */
  private currentTurnModel?: string;
  private sessionPermissionMode?: PermissionMode;
  private sessionPlanFilePath?: string;
  private askUserQuestion?: AskUserQuestionPrompt;
  private callbacks: Pick<
    AgentRuntimeOptions,
    | "confirm"
    | "onTextDelta"
    | "onReasoningDelta"
    | "onReasoningEnd"
    | "onStreamUsage"
    | "onToolStart"
    | "onToolEnd"
    | "onAnswerRollback"
    | "shouldAbort"
  >;

  constructor(options: AgentRuntimeOptions) {
    this.registry = options.registry;
    this.cwd = resolve(options.cwd);
    this.askUserQuestion = options.askUserQuestion;
    this.callbacks = {
      confirm: options.confirm,
      onTextDelta: options.onTextDelta,
      onReasoningDelta: options.onReasoningDelta,
      onReasoningEnd: options.onReasoningEnd,
      onStreamUsage: options.onStreamUsage,
      onToolStart: options.onToolStart,
      onToolEnd: options.onToolEnd,
      onAnswerRollback: options.onAnswerRollback,
      shouldAbort: options.shouldAbort,
    };
  }

  async createSession(agentName = "main"): Promise<Session> {
    return sessionManager.createSession({ cwd: this.cwd, agentName });
  }

  async resumeSession(sessionId: SessionId): Promise<Session> {
    const session = await sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (resolve(session.cwd) !== this.cwd) {
      throw new Error(`Session cwd mismatch: ${session.cwd} vs ${this.cwd}`);
    }
    return sessionManager.updateSession(sessionId, { status: "active" });
  }

  /** Persist permission mode across user turns (CLI shift+tab, EnterPlanMode, ExitPlanMode). */
  setSessionPermissionMode(mode: PermissionMode, planFilePath?: string): void {
    this.sessionPermissionMode = mode;
    if (planFilePath !== undefined) {
      this.sessionPlanFilePath = planFilePath;
    }
    if (mode !== "plan") {
      this.sessionPlanFilePath = undefined;
    }
  }

  getSessionPermissionMode(): PermissionMode {
    return this.sessionPermissionMode ?? "default";
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

    await memory.append(
      createMessage("user", turn.text, {
        attachments: turn.attachments,
        metadata: buildUserTurnMetadata(turn),
      }),
    );

    const router = createLLMRouter(this.registry);
    const model = await resolveModel(definition.model, this.registry);
    this.currentTurnModel = model;

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
        .catch(() => {
          // Title generation is best-effort; keep default title on failure.
        });
    }

    const workspaceKako = await loadWorkspaceKakoMd(session.cwd);
    const globalContext = await loadGlobalUserContext();
    const environment = await resolveEnvironmentInfo(session.cwd, model);
    const transcript = await memory.loadTranscript();
    const sessionSummary =
      transcript.length > 0
        ? await sessionManager.loadSessionSummary(session.id)
        : undefined;
    const discoveredSkills = await discoverSkillsForAgent(session.cwd);
    const skillIndex = await toSkillIndex(discoveredSkills);

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
      transcript,
      workspaceKakoMd: workspaceKako?.content,
      globalContext: globalContext?.content,
      sessionSummary,
      availableSkills: skillIndex,
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
      shouldAbort: this.callbacks.shouldAbort,
      onSkillActivate: async ({ toolCall }) => {
        const parsed = parseSkillInput(toolCall.input);
        const loaded = await loadSkill(parsed.skill, session.cwd);
        const transcript = await memory.loadTranscript();
        const dialog = transcript.filter(
          (msg) => msg.role === "user" || msg.role === "assistant",
        );
        if (parsed.args?.trim()) {
          await memory.append(createMessage("user", parsed.args.trim()));
        }
        return buildSkillActivatedMessages({
          systemPromptBase: buildSystemPromptBase(definition, {
            globalContext: globalContext?.content,
            sessionSummary,
            environment,
            subagentDefinitions,
          }),
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
    return { session, response: responseText };
  }

  async endSession(session: Session): Promise<void> {
    await sessionManager.endSession(session.id);
    session.status = "ended";
    session.updatedAt = new Date().toISOString();
  }

  private userFacingCallbacks(sessionId: SessionId) {
    return {
      onTextDelta: this.callbacks.onTextDelta,
      onReasoningDelta: this.callbacks.onReasoningDelta,
      onReasoningEnd: this.callbacks.onReasoningEnd,
      onStreamUsage: (usage: LLMTokenUsage) => {
        getTurnBudget(sessionId)?.recordOutputTokens(usage.outputTokens);
        this.callbacks.onStreamUsage?.(usage);
      },
      onToolStart: this.callbacks.onToolStart,
      onToolEnd: this.callbacks.onToolEnd,
      onAnswerRollback: this.callbacks.onAnswerRollback,
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
    const registry = new ToolRegistry({
      cwd: session.cwd,
      sessionId: session.id,
      agentId,
      permissionMode: this.sessionPermissionMode ?? definition.permissionMode,
      capability,
      confirm: this.callbacks.confirm,
      askUserQuestion: this.askUserQuestion,
      allowedSkills: skillNamesForToolAllowlist(agentSkills),
      planFilePath: this.sessionPlanFilePath,
      initialActivatedSkills: options?.preactivatedSkill
        ? [options.preactivatedSkill.name]
        : undefined,
    });
    registerBuiltinTools(registry);
    await mcpManager.registerTo((def, handler) => registry.register(def, handler));

    if (definition.subagents?.length) {
      registry.register(
        agentToolDefinition,
        createAgentHandler({
          spawnSubAgent: (input, context) =>
            this.spawnSubAgent(session, definition, input, context.agentId),
        }),
      );
    }

    return registry;
  }

  private async spawnSubAgent(
    session: Session,
    parentDefinition: AgentDefinition,
    input: AgentToolInput,
    parentAgentId: string,
  ): Promise<string> {
    const subagentName = assertSubAgentSpawnAllowed(input, parentDefinition.subagents ?? []);

    if (input.run_in_background) {
      return this.spawnSubAgentInBackground(
        session,
        parentDefinition,
        input,
        parentAgentId,
        subagentName,
      );
    }

    return this.executeSubAgentRun({
      session,
      parentDefinition,
      input,
      parentAgentId,
      subagentName,
      shouldAbort: this.callbacks.shouldAbort,
    });
  }

  private spawnSubAgentInBackground(
    session: Session,
    parentDefinition: AgentDefinition,
    input: AgentToolInput,
    parentAgentId: string,
    subagentName: string,
  ): string {
    const taskId = `a${randomBytes(4).toString("hex")}`;
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();

    registerBackgroundTask(session.id, taskId, "agent", async () => {
      abortController.abort();
    });

    void this.executeSubAgentRun({
      session,
      parentDefinition,
      input,
      parentAgentId,
      subagentName,
      shouldAbort: () => abortController.signal.aborted || this.callbacks.shouldAbort?.() === true,
    })
      .then((result) => {
        void this.notifyAgentComplete(session.id, {
          taskId,
          subagentName,
          description: input.description,
          status: "completed",
          startedAt,
          completedAt: new Date().toISOString(),
          result,
        });
      })
      .catch((err) => {
        const stopped =
          abortController.signal.aborted || err instanceof TurnAbortedError;
        void this.notifyAgentComplete(session.id, {
          taskId,
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
        });
      })
      .finally(() => {
        completeBackgroundTask(session.id, taskId);
      });

    return formatBackgroundAgentLaunchResult({
      taskId,
      description: input.description,
      subagentName,
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
    shouldAbort?: () => boolean;
  }): Promise<string> {
    const { session, parentDefinition, subagentName, input: agentInput } = input;
    const subDefinition = await loadAgent(subagentName, session.cwd);
    const logger = new ToolLogger();
    const router = createLLMRouter(this.registry);

    const parentModel =
      this.currentTurnModel ?? (await resolveModel(parentDefinition.model, this.registry));

    const model = agentInput.model?.trim()
      ? await resolveModel(agentInput.model, this.registry)
      : subDefinition.model?.trim()
        ? await resolveModel(subDefinition.model, this.registry)
        : parentModel;

    const workspaceKako = await loadWorkspaceKakoMd(session.cwd);
    const globalContext = await loadGlobalUserContext();
    const environment = await resolveEnvironmentInfo(session.cwd, model);
    const subSkills = await discoverSkillsForAgent(session.cwd);
    const messages = await buildMessages({
      definition: subDefinition,
      transcript: [createMessage("user", agentInput.prompt)],
      workspaceKakoMd: workspaceKako?.content,
      globalContext: globalContext?.content,
      availableSkills: await toSkillIndex(subSkills),
      environment,
    });

    const subRegistry = new ToolRegistry({
      cwd: session.cwd,
      sessionId: session.id,
      agentId: `${input.parentAgentId}/${subagentName}`,
      permissionMode: subDefinition.permissionMode,
      confirm: this.callbacks.confirm,
      askUserQuestion: this.askUserQuestion,
      allowedSkills: skillNamesForToolAllowlist(subSkills),
    });
    registerBuiltinTools(subRegistry);
    await mcpManager.registerTo((def, handler) => subRegistry.register(def, handler));

    // Sub-agent: only tools declared in its agent YAML (no automatic full MCP surface).
    const allowedTools = resolveAllowedToolNames(subDefinition.tools, subRegistry, {
      disallowedTools: subDefinition.disallowedTools,
      excludeAgent: true,
    });

    const responseText = await runAgentLoop({
      router,
      registry: subRegistry,
      toolLogger: logger,
      messages,
      allowedTools,
      model,
      maxTurns: subDefinition.maxTurns ?? 20,
      blockAgentTool: true,
      shouldAbort: input.shouldAbort ?? this.callbacks.shouldAbort,
      callbacks: {
        onToolStart: this.callbacks.onToolStart,
        onToolEnd: this.callbacks.onToolEnd,
      },
    });

    return formatSubAgentResult(subagentName, agentInput.description, responseText);
  }
}
