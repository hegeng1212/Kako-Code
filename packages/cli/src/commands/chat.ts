import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  buildAgentTaskNotificationMessage,
  buildTaskNotificationMessage,
  checkProviderReadiness,
  createHarness,
  ensurePlanFile,
  formatSessionList,
  formatSlashHelp,
  getActiveProvider,
  getKakoHome,
  handleSlashCommand,
  initializeKakoHome,
  KAKO_CORE_VERSION,
  listSlashInvokableSkills,
  loadAgent,
  loadGlobalUserContext,
  loadProjectContext,
  loadProviderRegistry,
  loadSkill,
  prepareWorkflowConfirm,
  readPlanFile,
  resolvePlanFileForSession,
  registerAgentCompleteHandler,
  registerWorkflowCompleteHandler,
  resolveSkillSlashUserContent,
  resolveUserTurnInput,
  sessionManager,
  TurnAbortedError,
  getTranscriptLength,
  truncateSessionTranscript,
  unregisterAgentCompleteHandler,
  unregisterWorkflowCompleteHandler,
  type AgentTaskRecord,
  type WorkflowRunRecord,
} from "@kako/core";
import type { PermissionMode, Session, SlashCommandContext, ToolConfirmResult } from "@kako/shared";
import { getProviderModelLabel } from "@kako/shared";
import { initTerminalTheme } from "../ui/ansi.js";
import { guideProviderSetup } from "../ui/setup-guide.js";
import { createAskUserQuestionPrompt } from "../ui/ask-user-question.js";
import { isPlanFileDetail } from "../ui/tool-call-phrases.js";
import {
  renderAgentFinishedEventLine,
  renderWorkflowFinishedEventLine,
} from "../ui/tool-call-display.js";
import { formatPlanPathForDisplay } from "../ui/plan-box.js";
import { openFileInEditor } from "../ui/open-editor.js";
import { ChatLayout, ExitRequestedError } from "../ui/terminal-layout.js";
import { promptWorkspaceTrust } from "../ui/workspace-trust.js";
import {
  loadCliUsage,
  recordCliLaunch,
  resolveChatHeaderMode,
  type ChatHeaderMode,
} from "../ui/cli-usage.js";
import {
  renderError,
  renderFarewell,
  renderInfo,
  renderInitialInputFooter,
  renderSessionSwitch,
  type WelcomeScreenOptions,
} from "../ui/welcome.js";

export async function runChat(cwdArg: string): Promise<void> {
  initTerminalTheme();
  const cwd = resolve(cwdArg);
  await initializeKakoHome();
  let registry = await loadProviderRegistry();
  const readiness = checkProviderReadiness(registry);
  if (!readiness.ready) {
    await guideProviderSetup(readiness);
    registry = await loadProviderRegistry();
  }

  await sessionManager.ensureProjectsTrustMigrated();
  const existingProject = await sessionManager.findProject(cwd);
  let forceStandardWelcome = false;
  if (!existingProject || !sessionManager.isProjectTrusted(existingProject)) {
    const decision = await promptWorkspaceTrust(cwd);
    if (decision !== "trust") {
      return;
    }
    await sessionManager.markProjectTrusted(cwd);
    forceStandardWelcome = true;
  }

  const definition = await loadAgent("main", cwd);
  const projectContext = await loadProjectContext(cwd);
  const globalContext = await loadGlobalUserContext();

  const footer = renderInitialInputFooter();
  let session!: Session;

  const welcomeOpts = (): WelcomeScreenOptions => {
    const active = getActiveProvider(registry);
    return {
      version: KAKO_CORE_VERSION,
      agentName: definition.name,
      modelLabel: getProviderModelLabel(active.profile, active.model),
      cwd,
      contextPath: projectContext?.path,
      globalContextPath: !projectContext ? globalContext?.path : undefined,
      sessionId: session?.id ?? "…",
      sessionLabel: `${definition.name} agent · new session`,
      dataDir: getKakoHome(),
    };
  };

  let layout!: ChatLayout;
  let syncSessionPermissionMode!: (mode: PermissionMode) => Promise<void>;
  type PendingTaskNotification =
    | { kind: "workflow"; record: WorkflowRunRecord }
    | { kind: "agent"; record: AgentTaskRecord };

  let pendingTaskNotification: PendingTaskNotification | null = null;

  const usage = await loadCliUsage();
  const headerMode: ChatHeaderMode = forceStandardWelcome
    ? "standard"
    : resolveChatHeaderMode(usage);
  await recordCliLaunch();

  layout = new ChatLayout(welcomeOpts, footer, headerMode);
  layout.setSlashInvokableSkills(await listSlashInvokableSkills(cwd));
  layout.start();

  const refreshInputHistory = async (): Promise<void> => {
    await layout.syncInputHistoryFromSession(session.id, { merge: true });
  };

  const syncProviderFromDisk = async (): Promise<void> => {
    registry = await loadProviderRegistry();
    layout.refreshHeader();
  };

  const refreshWorkflowUi = (sessionId: string): void => {
    void layout.refreshWorkflowFooter(sessionId);
  };

  const runTaskNotificationTurn = async (
    llmText: string,
    eventLine: string,
  ): Promise<void> => {
    const userTurn = await resolveUserTurnInput(session.id, "", []);
    userTurn.llmText = llmText;
    layout.beginTurn("");
    layout.appendTurnTimeline(eventLine);
    try {
      await harness.runtime.runTurn(session, userTurn);
    } catch (err) {
      if (err instanceof ExitRequestedError || err instanceof TurnAbortedError) return;
      throw err;
    } finally {
      layout.finishTurn();
      await refreshInputHistory();
      await flushPendingTaskNotification();
    }
  };

  const flushPendingTaskNotification = async (): Promise<void> => {
    if (!pendingTaskNotification || layout.isTurnInProgress()) return;
    const pending = pendingTaskNotification;
    pendingTaskNotification = null;
    if (pending.kind === "workflow") {
      await runTaskNotificationTurn(
        buildTaskNotificationMessage(pending.record, { sessionId: session.id, cwd }),
        renderWorkflowFinishedEventLine(pending.record),
      );
      return;
    }
    await runTaskNotificationTurn(
      buildAgentTaskNotificationMessage(pending.record),
      renderAgentFinishedEventLine(pending.record.description),
    );
  };

  const handleWorkflowComplete = async (record: WorkflowRunRecord): Promise<void> => {
    refreshWorkflowUi(session.id);
    if (layout.isTurnInProgress()) {
      layout.appendWorkflowCompletedEvent(renderWorkflowFinishedEventLine(record));
      pendingTaskNotification = { kind: "workflow", record };
      return;
    }
    await runTaskNotificationTurn(
      buildTaskNotificationMessage(record, { sessionId: session.id, cwd }),
      renderWorkflowFinishedEventLine(record),
    );
  };

  const handleAgentComplete = async (record: AgentTaskRecord): Promise<void> => {
    if (layout.isTurnInProgress()) {
      layout.appendTurnTimeline(renderAgentFinishedEventLine(record.description));
      pendingTaskNotification = { kind: "agent", record };
      return;
    }
    await runTaskNotificationTurn(
      buildAgentTaskNotificationMessage(record),
      renderAgentFinishedEventLine(record.description),
    );
  };

  const bindWorkflowSession = (sessionId: string): void => {
    unregisterWorkflowCompleteHandler(sessionId);
    unregisterAgentCompleteHandler(sessionId);
    registerWorkflowCompleteHandler(sessionId, (record) => {
      void handleWorkflowComplete(record);
    });
    registerAgentCompleteHandler(sessionId, (record) => {
      void handleAgentComplete(record);
    });
    layout.startWorkflowPolling(sessionId);
  };

  const harness = await createHarness({
    cwd,
    confirm: async (toolCall): Promise<ToolConfirmResult> => {
      if (toolCall.name === "ExitPlanMode") {
        const planPath = await resolvePlanFileForSession(session.id);
        const planText = await readPlanFile(planPath);
        const decision = await layout.readPlanReview({ planPath, planText });
        if (decision.action === "cancel") {
          return false;
        }
        if (decision.action === "revise") {
          return {
            allowed: false,
            denialReason: `User requested plan changes:\n\n${decision.feedback ?? ""}`,
          };
        }
        if (decision.action === "auto") {
          void syncSessionPermissionMode("bypassPermissions");
          return { allowed: true, permissionMode: "bypassPermissions" };
        }
        void syncSessionPermissionMode("acceptEdits");
        return { allowed: true, permissionMode: "acceptEdits" };
      }
      if (toolCall.name === "Workflow") {
        try {
          const preview = await prepareWorkflowConfirm({
            sessionId: session.id,
            cwd,
            name: typeof toolCall.input.name === "string" ? toolCall.input.name : undefined,
            script: typeof toolCall.input.script === "string" ? toolCall.input.script : undefined,
            scriptPath:
              typeof toolCall.input.scriptPath === "string" ? toolCall.input.scriptPath : undefined,
          });
          const decision = await layout.readWorkflowConfirm({
            meta: preview.meta,
            args: toolCall.input.args,
            scriptSource: preview.source,
            scriptPath: preview.previewScriptPath,
          });
          if (decision.action === "cancel") {
            return {
              allowed: false,
              denialReason: "User declined to run the workflow.",
            };
          }
          return {
            allowed: true,
            inputPatch: {
              scriptPath: decision.scriptPath ?? preview.previewScriptPath,
              script: undefined,
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            allowed: false,
            denialReason: `Workflow could not be prepared: ${message}`,
          };
        }
      }
      return layout.readToolApproval({ toolCall, cwd });
    },
    askUserQuestion: createAskUserQuestionPrompt(layout),
    onReasoningDelta: (text) => layout.appendThinking(text),
    onReasoningEnd: () => layout.endThinkingStream(),
    onTextDelta: (text) => layout.appendAnswer(text),
    onAnswerRollback: (chars) => layout.rollbackAnswer(chars),
    onStreamUsage: (usage) => layout.setTurnTokens(usage.outputTokens),
    onToolStart: (name, toolInput) => {
      if (name === "AskUserQuestion") return;
      layout.beginToolCall(name, summarizeInput(name, toolInput), toolInput);
      if (name === "Write" && toolInput) {
        const writePath = String(toolInput.file_path ?? toolInput.path ?? "").trim();
        if (writePath) {
          try {
            layout.updateLastWaitingToolPriorContent(readFileSync(writePath, "utf8"));
          } catch {
            // New file — no prior content to diff against.
          }
        }
      }
      if (name === "Workflow") {
        refreshWorkflowUi(session.id);
      }
    },
    onToolEnd: (name, status, error, output, input) => {
      if (name === "AskUserQuestion") return;
      let displayOutput = output;
      if (status === "success" && (name === "Write" || name === "Edit") && input) {
        const detail = summarizeInput(name, input);
        if (name === "Write" && (typeof input.content === "string" || typeof input.contents === "string")) {
          displayOutput = String(input.content ?? input.contents);
        } else if (name === "Edit") {
          const editPath = String(input.file_path ?? input.path ?? detail);
          void readFile(editPath, "utf8").then((text) => {
            if (text) layout.updateLastToolOutput(text);
          });
        } else if (isPlanFileDetail(detail)) {
          const planPath = String(input.file_path ?? input.path ?? detail);
          void readPlanFile(planPath).then((text) => {
            if (text) layout.updateLastToolOutput(text);
          });
        }
      }
      layout.finishToolCall(name, status, error, displayOutput);
      if (name === "Agent" && status === "success" && input?.run_in_background !== true) {
        const description =
          typeof input.description === "string" ? input.description.trim() : "";
        if (description) {
          layout.appendTurnTimeline(renderAgentFinishedEventLine(description));
        }
      }
      if (name === "Workflow") {
        refreshWorkflowUi(session.id);
      }
      if (status === "success" && name === "EnterPlanMode") {
        void syncSessionPermissionMode("plan");
      }
    },
    shouldAbort: () => layout.isTurnExitRequested(),
  });

  session = await harness.runtime.createSession();
  layout.setSessionId(session.id);
  await layout.syncInputHistoryFromSession(session.id);
  bindWorkflowSession(session.id);

  syncSessionPermissionMode = async (mode: PermissionMode): Promise<void> => {
    layout.setPermissionMode(mode);
    if (mode === "plan") {
      const meta = await sessionManager.getSessionMeta(session.id);
      const planPath = await ensurePlanFile(session.id, meta?.title);
      harness.runtime.setSessionPermissionMode("plan", planPath);
      return;
    }
    harness.runtime.setSessionPermissionMode(mode);
  };

  layout.setPermissionModeChangeHandler((mode) => {
    const wasPlan = layout.getPermissionMode() === "plan";
    void syncSessionPermissionMode(mode).then(() => {
      if (mode === "plan" && !wasPlan) {
        layout.beginTurn("/plan");
        layout.appendPlanEnabledEvent();
        layout.finishHarnessTurn();
      }
    });
  });

  const slashCtx = (): SlashCommandContext => ({
    cwd,
    session,
    listSessions: () => sessionManager.listSessions({ cwd }),
    createSession: (agentName) => harness.runtime.createSession(agentName),
    endSession: (id) =>
      id === session.id
        ? harness.runtime.endSession(session)
        : sessionManager.endSession(id),
    resumeSession: (id) => harness.runtime.resumeSession(id),
    updateTitle: (id, title) => sessionManager.updateSession(id, { title }),
  });

  let firstPrompt = true;
  let restoreInput: string | undefined;

  const finalizeActiveTurn = async (
    transcriptCountBefore: number,
  ): Promise<"continue" | "exit"> => {
    await flushPendingTaskNotification();
    if (layout.consumeAppExitRequested()) {
      await truncateSessionTranscript(session.id, transcriptCountBefore);
      layout.discardActiveTurn();
      await refreshInputHistory();
      return "exit";
    }
    const restore = layout.consumeTurnRestoreInput();
    if (layout.consumeTurnDiscardOnAbort()) {
      await truncateSessionTranscript(session.id, transcriptCountBefore);
      layout.discardActiveTurn();
      if (restore) restoreInput = restore;
    } else {
      layout.finishTurn();
    }
    await refreshInputHistory();
    return "continue";
  };

  try {
    chatLoop: while (true) {
      await syncProviderFromDisk();
      let line: string;
      try {
        line = await layout.readLine({
          placeholder: firstPrompt ? 'Try "explain this codebase"' : undefined,
          plain: !firstPrompt,
          initialValue: restoreInput,
        });
      } catch (err) {
        if (err instanceof ExitRequestedError) break chatLoop;
        throw err;
      }
      restoreInput = undefined;
      firstPrompt = false;
      await flushPendingTaskNotification();

      const trimmed = line.trim();
      if (!trimmed) continue;

      const submitLine = line.trimEnd();
      let slashLine = line.split("\n")[0]?.trim() ?? "";
      const barePlanMatch = trimmed.match(/^plan(?:\s+(.*))?$/i);
      if (barePlanMatch && !trimmed.startsWith("/")) {
        slashLine = barePlanMatch[1] ? `/plan ${barePlanMatch[1]}` : "/plan";
      }

      const result = await handleSlashCommand(slashLine, slashCtx());

      switch (result.type) {
        case "exit":
          break;
        case "handled": {
          if (slashLine === "/help" || slashLine.startsWith("/help ")) {
            layout.appendContent(formatSlashHelp());
          } else if (slashLine === "/sessions" || slashLine.startsWith("/sessions ")) {
            const sessions = await sessionManager.listSessions({ cwd });
            layout.appendContent(await formatSessionList(sessions));
          } else if (slashLine.startsWith("/title")) {
            const meta = await sessionManager.getSessionMeta(session.id);
            layout.appendContent(
              renderInfo(`Session title: ${meta?.title ?? session.id}`),
            );
          }
          continue;
        }
        case "error":
          layout.appendContent(renderError(result.message));
          continue;
        case "switch":
          unregisterWorkflowCompleteHandler(session.id);
          unregisterAgentCompleteHandler(session.id);
          session = result.session;
          layout.setSessionId(session.id);
          await layout.syncInputHistoryFromSession(session.id);
          bindWorkflowSession(session.id);
          layout.appendContent(renderSessionSwitch(session.id));
          continue;
        case "workflows-panel":
          await layout.openWorkflowsPanel(session.id);
          continue;
        case "plan-view": {
          const meta = await sessionManager.getSessionMeta(session.id);
          const planPath = await resolvePlanFileForSession(session.id, {
            topicHint: meta?.title,
          });
          const planText = await readPlanFile(planPath);
          layout.beginTurn(result.displayText);
          if (!planText.trim()) {
            const alreadyPlan = layout.getPermissionMode() === "plan";
            if (!alreadyPlan) {
              await syncSessionPermissionMode("plan");
              layout.appendPlanEnabledEvent();
            }
            layout.finishHarnessTurn();
            await refreshInputHistory();
            continue;
          }
          layout.appendPlanPreviewEvent(planPath, planText);
          layout.finishHarnessTurn();
          await refreshInputHistory();
          continue;
        }
        case "plan-open": {
          const meta = await sessionManager.getSessionMeta(session.id);
          const planPath = await ensurePlanFile(session.id, meta?.title);
          const opened = await openFileInEditor(planPath);
          layout.beginTurn(result.displayText);
          if (opened) {
            layout.appendTurnTimeline(
              `└ Opened ${formatPlanPathForDisplay(planPath)} in editor`,
            );
          } else {
            layout.appendTurnTimeline(
              "└ Could not open editor (install VS Code, Cursor, or set $EDITOR)",
            );
          }
          layout.finishHarnessTurn();
          await refreshInputHistory();
          continue;
        }
        case "plan-enter": {
          const alreadyPlan = layout.getPermissionMode() === "plan";
          if (!alreadyPlan) {
            await syncSessionPermissionMode("plan");
          }
          layout.beginTurn(result.displayText);
          if (!alreadyPlan) {
            layout.appendPlanEnabledEvent();
          }
          if (result.question) {
            const userTurn = await resolveUserTurnInput(
              session.id,
              result.question,
              layout.consumePendingAttachments(result.question),
            );
            userTurn.cliInput = true;
            const transcriptCountBefore = await getTranscriptLength(session.id);
            try {
              await harness.runtime.runTurn(session, userTurn);
            } catch (err) {
              if (err instanceof ExitRequestedError) break chatLoop;
              if (err instanceof TurnAbortedError) {
                // finalizeActiveTurn discards or restores the prompt; stay in chat.
              } else {
                throw err;
              }
            } finally {
              if ((await finalizeActiveTurn(transcriptCountBefore)) === "exit") break chatLoop;
            }
          } else {
            layout.finishHarnessTurn();
            await refreshInputHistory();
          }
          continue;
        }
        case "skill-slash": {
          const slashContent = await resolveSkillSlashUserContent(
            result.name,
            result.args,
            result.handler,
            cwd,
          );
          const userTurn = await resolveUserTurnInput(
            session.id,
            result.displayText,
            layout.consumePendingAttachments(result.displayText),
          );
          if (slashContent.mode === "blocks") {
            userTurn.llmBlocks = slashContent.blocks;
          } else {
            userTurn.llmText = slashContent.text;
          }
          userTurn.cliInput = true;
          const transcriptCountBefore = await getTranscriptLength(session.id);
          layout.beginTurn(result.displayText);
          let runOptions;
          if (result.handler === "skill") {
            const loaded = await loadSkill(result.name, cwd);
            runOptions = {
              preactivatedSkill: {
                name: loaded.name,
                instructions: loaded.instructions,
              },
            };
          }
          try {
            await harness.runtime.runTurn(session, userTurn, runOptions);
          } catch (err) {
            if (err instanceof ExitRequestedError) break chatLoop;
            if (err instanceof TurnAbortedError) {
              // finalizeActiveTurn discards or restores the prompt; stay in chat.
            } else {
              throw err;
            }
          } finally {
            if ((await finalizeActiveTurn(transcriptCountBefore)) === "exit") break chatLoop;
          }
          continue;
        }
        case "message": {
          const userTurn = await resolveUserTurnInput(
            session.id,
            submitLine,
            layout.consumePendingAttachments(submitLine),
          );
          userTurn.cliInput = true;
          const transcriptCountBefore = await getTranscriptLength(session.id);
          layout.beginTurn(userTurn.text.trim() || submitLine);
          try {
            await harness.runtime.runTurn(session, userTurn);
          } catch (err) {
            if (err instanceof ExitRequestedError) break chatLoop;
            if (err instanceof TurnAbortedError) {
              // finalizeActiveTurn discards or restores the prompt; stay in chat.
            } else {
              throw err;
            }
          } finally {
            if ((await finalizeActiveTurn(transcriptCountBefore)) === "exit") break chatLoop;
          }
          continue;
        }
      }
    }
  } finally {
    unregisterWorkflowCompleteHandler(session.id);
    unregisterAgentCompleteHandler(session.id);
    if (session.status !== "ended") {
      await harness.runtime.endSession(session);
    }
    layout.stop();
    console.log(renderFarewell());
  }
}

function summarizeInput(name: string, input: Record<string, unknown>): string {
  if (name === "Workflow") {
    if (typeof input.name === "string" && input.name.trim()) {
      return `dynamic workflow: ${input.name.trim()}`;
    }
    if (typeof input.scriptPath === "string" && input.scriptPath.trim()) {
      const base = basename(input.scriptPath.trim());
      const fromSession = base.match(/^(.+?)-wf_[a-z0-9-]+\.js$/i);
      if (fromSession?.[1]) return `dynamic workflow: ${fromSession[1]}`;
      const fromTemplate = base.match(/^(.+)\.js$/i);
      if (fromTemplate?.[1]) return `dynamic workflow: ${fromTemplate[1]}`;
    }
  }
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  if (input.skill) return String(input.skill);
  if (input.command) return String(input.command).slice(0, 60);
  if (input.description) return String(input.description).slice(0, 80);
  return JSON.stringify(input).slice(0, 60);
}
