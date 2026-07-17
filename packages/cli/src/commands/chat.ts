import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  buildAgentWakeUserMessage,
  buildTaskNotificationMessage,
  checkProviderReadiness,
  createHarness,
  ensurePlanFile,
  formatSessionList,
  formatSlashHelp,
  FileMemoryStore,
  getActiveProvider,
  getKakoHome,
  handleSlashCommand,
  initializeKakoHome,
  KAKO_CORE_VERSION,
  listBackgroundTasks,
  loadWorkflowRuns,
  updateWorkflowRun,
  listUnpresentedTerminalWorkflowRuns,
  listTerminalRunsNeedingPresentedHeal,
  sessionsWithRunningBackgroundWork,
  reconcileStaleBackgroundWork,
  checkpointBackgroundWorkForProcessExit,
  listResumableInterrupted,
  markInterruptedDiscarded,
  removeInterruptedItem,
  resumeInterruptedWorkflow,
  agentInputFromInterrupted,
  prepareWorkflowConfirm,
  listSlashInvokableSkills,
  clearSessionConversation,
  loadAgent,
  loadGlobalUserContext,
  loadProjectContext,
  loadProviderRegistry,
  loadSkill,
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
  summarizeTranscriptRange,
  restoreCodeChangesFromTranscript,
  unregisterAgentCompleteHandler,
  unregisterWorkflowCompleteHandler,
  sessionHasUserDialogue,
  isDefaultSessionTitle,
  type AgentTaskRecord,
  type WorkflowRunRecord,
} from "@kako/core";
import type { PermissionMode, Session, SlashCommandContext, ToolConfirmResult } from "@kako/shared";
import { getProviderModelLabel } from "@kako/shared";
import { initTerminalTheme } from "../ui/ansi.js";
import { guideProviderSetup } from "../ui/setup-guide.js";
import { createAskUserQuestionPrompt } from "../ui/ask-user-question.js";
import { raceToolConfirmWithTurnAbort } from "../ui/tool-confirm-abort.js";
import { isPlanFileDetail, formatReadDisplayDetail } from "../ui/tool-call-phrases.js";
import {
  renderAgentFinishedEventLine,
  renderWorkflowFinishedEventLine,
} from "../ui/tool-call-display.js";
import { decideWorkflowCompletionPresent } from "../ui/workflow-completion-present.js";
import {
  buildSteppedAwayRecapWakeMessage,
  normalizeRecapText,
  truncateRecapDetail,
} from "../ui/stepped-away-recap.js";
import { formatPlanPathForDisplay } from "../ui/plan-box.js";
import { pickInputPlaceholder } from "../ui/input-placeholders.js";
import { openFileInEditor } from "../ui/open-editor.js";
import {
  agentResumeDecisionFromRow,
  buildAgentResumeConfirmRows,
  formatAgentResumeSummary,
} from "../ui/agent-resume-confirm.js";
import type { InterruptedBackgroundItem } from "@kako/core";
import {
  ChatLayout,
  ExitRequestedError,
  SessionHandoffError,
} from "../ui/terminal-layout.js";
import { sessionAnswerDurationMs } from "../ui/session-answer-duration.js";
import { rewindTurnsFromTranscript } from "../ui/session-history.js";
import { summaryPreviewLine, lastSubstantiveTranscriptPreview, interruptedPreviewCue } from "../ui/agents-panel.js";
import { agentsReplyShouldResumeInterrupted } from "../ui/agents-reply-interrupted.js";
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
import {
  debugError,
  debugLog,
  debugStack,
  getCliDebugLogPath,
  isCliDebugEnabled,
} from "../ui/cli-debug-log.js";

export async function runChat(cwdArg: string): Promise<void> {
  initTerminalTheme();
  let cwd = resolve(cwdArg);
  let agentsEntryCwd = cwd;
  await initializeKakoHome();
  let registry = await loadProviderRegistry();
  const readiness = checkProviderReadiness(registry);
  if (!readiness.ready) {
    await guideProviderSetup(readiness);
    registry = await loadProviderRegistry();
  }

  await sessionManager.ensureProjectsTrustMigrated();
  // Background workflow/agent handles die with the process. Demote stale
  // "working" / orphaned runs so interrupted research reappears under Needs input.
  await reconcileStaleBackgroundWork();
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
    const title =
      typeof session?.metadata?.title === "string" && session.metadata.title.trim()
        ? session.metadata.title.trim()
        : "new session";
    return {
      version: KAKO_CORE_VERSION,
      agentName: definition.name,
      modelLabel: getProviderModelLabel(active.profile, active.model),
      cwd,
      contextPath: projectContext?.path,
      globalContextPath: !projectContext ? globalContext?.path : undefined,
      sessionId: session?.id ?? "…",
      sessionLabel: `${definition.name} agent · ${title}`,
      dataDir: getKakoHome(),
    };
  };

  let layout!: ChatLayout;
  let syncSessionPermissionMode!: (
    sessionId: string,
    mode: PermissionMode,
  ) => Promise<void>;
  type PendingTaskNotification =
    | { kind: "workflow"; record: WorkflowRunRecord }
    | { kind: "agent"; record: AgentTaskRecord };

  /** Completions keyed by owner session — flush only when that session is foreground. */
  const pendingNotificationsBySession = new Map<string, PendingTaskNotification[]>();
  /** Sessions that keep workflow/agent complete handlers across chat switches. */
  const lifecycleBoundSessions = new Set<string>();

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
    if (sessionId === session.id) {
      void layout.refreshWorkflowFooter(sessionId);
    }
  };

  const queueSessionNotification = (
    sessionId: string,
    pending: PendingTaskNotification,
  ): void => {
    const queue = pendingNotificationsBySession.get(sessionId) ?? [];
    if (
      pending.kind === "workflow" &&
      queue.some(
        (item) =>
          item.kind === "workflow" &&
          (item.record.runId === pending.record.runId ||
            item.record.taskId === pending.record.taskId),
      )
    ) {
      return;
    }
    queue.push(pending);
    pendingNotificationsBySession.set(sessionId, queue);
  };

  const markSessionReadyToPresent = async (
    sessionId: string,
    detail: string,
  ): Promise<void> => {
    await sessionManager.updateSession(sessionId, {
      agentState: {
        state: "blocked",
        detail,
        tempo: "blocked",
        needs: "open session to continue",
        since: new Date().toISOString(),
      },
    });
  };

  const runTaskNotificationTurn = async (
    targetSessionId: string,
    llmText: string,
    eventLine: string,
  ): Promise<boolean> => {
    if (targetSessionId !== session.id) return false;
    const userTurn = await resolveUserTurnInput(targetSessionId, "", []);
    userTurn.llmText = llmText;
    layout.beginTurn("");
    layout.appendTurnTimeline(eventLine);
    try {
      await harness.runtime.runTurn(session, userTurn);
      return true;
    } catch (err) {
      if (err instanceof ExitRequestedError || err instanceof TurnAbortedError) return false;
      throw err;
    } finally {
      layout.finishTurn();
      await refreshInputHistory();
      await flushSessionNotificationQueue(targetSessionId);
    }
  };

  /** Refocus wake: model writes a short recap; UI shows ✴ recap: on the prior turn. */
  const runSteppedAwayRecapTurn = async (): Promise<void> => {
    if (layout.isTurnInProgress() || layout.isAgentsPanelOpen() || layout.hasForegroundBlockingOverlay()) {
      return;
    }
    const llmText = buildSteppedAwayRecapWakeMessage();
    const userTurn = await resolveUserTurnInput(session.id, "", []);
    userTurn.llmText = llmText;
    // Separate model Q&A: mute stream so thinking/answer never enter the chat timeline.
    layout.muteChatStream();
    layout.beginTurn("");
    layout.markActiveTurnHarnessOnly({ silentChat: true });
    try {
      const result = await harness.runtime.runTurn(session, userTurn);
      const recap = normalizeRecapText(result.response ?? "");
      layout.suppressActiveTurnAnswer();
      if (recap) {
        layout.applyRecapToLastCompletedTurn(recap);
        const meta = await sessionManager.getSessionMeta(session.id);
        await sessionManager.updateSession(session.id, {
          agentState: {
            state: meta?.agentState?.state ?? "done",
            detail: truncateRecapDetail(recap),
            tempo: meta?.agentState?.tempo ?? "idle",
            needs: meta?.agentState?.needs ?? "",
            since: new Date().toISOString(),
            result: meta?.agentState?.result,
          },
        });
      }
    } catch (err) {
      if (err instanceof ExitRequestedError || err instanceof TurnAbortedError) return;
      throw err;
    } finally {
      layout.suppressActiveTurnAnswer();
      layout.finishTurn();
      layout.unmuteChatStream();
      await refreshInputHistory();
    }
  };

  layout.setSteppedAwayRecapHandler(() => runSteppedAwayRecapTurn());

  const notificationBelongsToSession = async (
    sessionId: string,
    pending: PendingTaskNotification,
  ): Promise<boolean> => {
    if (pending.kind === "agent") {
      // Agent tasks may already be removed from the live map after completion;
      // queue key (ownerSessionId) is the ownership contract.
      return true;
    }
    const runs = await loadWorkflowRuns(sessionId);
    return runs.some(
      (run) =>
        run.taskId === pending.record.taskId || run.runId === pending.record.runId,
    );
  };

  const deliverSessionNotification = async (
    sessionId: string,
    pending: PendingTaskNotification,
  ): Promise<void> => {
    if (sessionId !== session.id) return;
    if (!(await notificationBelongsToSession(sessionId, pending))) return;
    if (pending.kind === "workflow") {
      const runs = await loadWorkflowRuns(sessionId);
      const latest = runs.find((run) => run.runId === pending.record.runId);
      if (latest?.presentedAt) return;
      const delivered = await runTaskNotificationTurn(
        sessionId,
        buildTaskNotificationMessage(pending.record, {
          sessionId,
          cwd,
        }),
        renderWorkflowFinishedEventLine(pending.record),
      );
      if (delivered) {
        await updateWorkflowRun(sessionId, pending.record.runId, {
          presentedAt: new Date().toISOString(),
        });
      }
      return;
    }
    await runTaskNotificationTurn(
      sessionId,
      buildAgentWakeUserMessage(pending.record),
      renderAgentFinishedEventLine(pending.record.description),
    );
  };

  const flushSessionNotificationQueue = async (sessionId: string): Promise<void> => {
    while (true) {
      const queue = pendingNotificationsBySession.get(sessionId);
      if (!queue?.length) return;
      if (session.id !== sessionId) {
        debugLog("notify:flush-skip", { reason: "session-switched", sessionId, foreground: session.id });
        return;
      }
      if (layout.isTurnInProgress() || layout.isAgentsPanelOpen()) {
        debugLog("notify:flush-defer", {
          sessionId,
          queueLen: queue.length,
          turnInProgress: layout.isTurnInProgress(),
          agentsOpen: layout.isAgentsPanelOpen(),
        });
        return;
      }
      const next = queue.shift()!;
      if (queue.length === 0) pendingNotificationsBySession.delete(sessionId);
      else pendingNotificationsBySession.set(sessionId, queue);
      debugLog("notify:deliver", {
        sessionId,
        kind: next.kind,
        runId: next.kind === "workflow" ? next.record.runId : next.record.taskId,
        remaining: queue.length,
      });
      await deliverSessionNotification(sessionId, next);
    }
  };

  const handleWorkflowComplete = async (
    ownerSessionId: string,
    record: WorkflowRunRecord,
  ): Promise<void> => {
    refreshWorkflowUi(ownerSessionId);
    const pending: PendingTaskNotification = { kind: "workflow", record };
    const detail =
      record.status === "completed"
        ? "workflow finished — open to present report"
        : `workflow ${record.status} — open to continue`;

    const mode = decideWorkflowCompletionPresent({
      isForegroundSession: ownerSessionId === session.id,
      agentsPanelOpen: layout.isAgentsPanelOpen(),
      turnInProgress: layout.isTurnInProgress(),
    });
    debugLog("workflow:complete", {
      ownerSessionId,
      foreground: session.id,
      runId: record.runId,
      status: record.status,
      mode,
    });
    if (mode === "queue_and_mark_ready") {
      queueSessionNotification(ownerSessionId, pending);
      await markSessionReadyToPresent(ownerSessionId, detail);
      return;
    }
    if (mode === "queue_only") {
      // Do not preview the finished event line — deliverSessionNotification appends it once.
      queueSessionNotification(ownerSessionId, pending);
      return;
    }
    await deliverSessionNotification(ownerSessionId, pending);
  };

  const handleAgentComplete = async (
    ownerSessionId: string,
    record: AgentTaskRecord,
  ): Promise<void> => {
    const pending: PendingTaskNotification = { kind: "agent", record };
    const mode = decideWorkflowCompletionPresent({
      isForegroundSession: ownerSessionId === session.id,
      agentsPanelOpen: layout.isAgentsPanelOpen(),
      turnInProgress: layout.isTurnInProgress(),
    });
    if (mode === "queue_and_mark_ready") {
      queueSessionNotification(ownerSessionId, pending);
      await markSessionReadyToPresent(
        ownerSessionId,
        "background agent finished — open to continue",
      );
      return;
    }
    if (mode === "queue_only") {
      queueSessionNotification(ownerSessionId, pending);
      return;
    }
    await deliverSessionNotification(ownerSessionId, pending);
  };

  const dropSessionLifecycle = (sessionId: string): void => {
    lifecycleBoundSessions.delete(sessionId);
    unregisterWorkflowCompleteHandler(sessionId);
    unregisterAgentCompleteHandler(sessionId);
    pendingNotificationsBySession.delete(sessionId);
  };

  /** Keep completion handlers for every session that may run background work. */
  const ensureSessionLifecycle = (sessionId: string): void => {
    if (lifecycleBoundSessions.has(sessionId)) return;
    lifecycleBoundSessions.add(sessionId);
    registerWorkflowCompleteHandler(sessionId, (record) => {
      void handleWorkflowComplete(sessionId, record);
    });
    registerAgentCompleteHandler(sessionId, (record) => {
      void handleAgentComplete(sessionId, record);
    });
  };

  const bindWorkflowSession = (sessionId: string): void => {
    ensureSessionLifecycle(sessionId);
    layout.startWorkflowPolling(sessionId);
    void flushSessionNotificationQueue(sessionId);
  };

  /**
   * Completions only live in process memory. After crash/restart, disk may show
   * a terminal workflow with a result that never woke the chat. Re-queue those.
   */
  const recoverUnpresentedWorkflowCompletions = async (
    sessionId: string,
  ): Promise<void> => {
    const runs = await loadWorkflowRuns(sessionId);
    if (runs.length === 0) return;
    const memory = new FileMemoryStore(sessionId);
    const transcript = await memory.loadTranscript();

    for (const run of listTerminalRunsNeedingPresentedHeal(runs, transcript)) {
      await updateWorkflowRun(sessionId, run.runId, {
        presentedAt: run.completedAt ?? new Date().toISOString(),
      });
    }

    for (const run of listUnpresentedTerminalWorkflowRuns(runs, transcript)) {
      void handleWorkflowComplete(sessionId, run);
    }
  };

  /** Process-local dismiss: do not re-prompt for these checkpoint ids until CLI exits. */
  const dismissedInterruptedIds = new Set<string>();

  /** Session that currently owns an interactive overlay (set after acquire). */
  let interactiveSessionId = "";

  const markSessionNeedsInput = async (sessionId: string, detail: string): Promise<void> => {
    await sessionManager.updateSession(sessionId, {
      agentState: {
        state: "blocked",
        detail,
        tempo: "blocked",
        needs: "user input",
        since: new Date().toISOString(),
      },
    });
  };

  /** After AskUser / approval, resume Working when the turn or BackgroundTask continues. */
  const markSessionWorkingIfContinuing = async (sessionId: string): Promise<void> => {
    const turnActive = layout.isTurnInProgressFor(sessionId);
    const hasBg = listBackgroundTasks(sessionId).some((task) => !task.stopped);
    if (!turnActive && !hasBg) return;
    await sessionManager.updateSession(sessionId, {
      agentState: {
        state: "working",
        detail: turnActive ? "running turn" : "background work running",
        tempo: "active",
        since: new Date().toISOString(),
      },
    });
  };

  const harness = await createHarness({
    cwd,
    beforeInteractive: async (sessionId) => {
      ensureSessionLifecycle(sessionId);
      await markSessionNeedsInput(sessionId, "waiting for user input");
      await layout.acquireSessionOverlay(sessionId);
      interactiveSessionId = sessionId;
    },
    afterInteractive: (sessionId) => {
      layout.releaseSessionOverlay(sessionId);
      if (interactiveSessionId === sessionId) {
        interactiveSessionId = "";
      }
      void markSessionWorkingIfContinuing(sessionId);
    },
    confirm: async (toolCall): Promise<ToolConfirmResult> => {
      const confirmSessionId = interactiveSessionId || session.id;
      const isAborted = () => layout.isTurnExitRequestedFor(confirmSessionId);
      const withAbort = (run: () => Promise<ToolConfirmResult>) =>
        raceToolConfirmWithTurnAbort(run, isAborted, {
          onAbort: () => layout.settlePendingOverlaysForTurnCancel(),
        });

      if (toolCall.name === "ExitPlanMode") {
        const mode =
          harness.runtime.getSessionPermissionMode(confirmSessionId) ||
          layout.getPermissionMode();
        // Confirm UI is Plan-mode only; elsewhere the tool itself no-ops.
        if (mode !== "plan") {
          return true;
        }
        return withAbort(async () => {
          const planPath = await resolvePlanFileForSession(confirmSessionId);
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
            void syncSessionPermissionMode(confirmSessionId, "bypassPermissions");
            return { allowed: true, permissionMode: "bypassPermissions" };
          }
          void syncSessionPermissionMode(confirmSessionId, "acceptEdits");
          return { allowed: true, permissionMode: "acceptEdits" };
        });
      }
      if (toolCall.name === "Workflow") {
        return withAbort(async () => {
          try {
            const preview = await prepareWorkflowConfirm({
              sessionId: confirmSessionId,
              cwd,
              name: typeof toolCall.input.name === "string" ? toolCall.input.name : undefined,
              script: typeof toolCall.input.script === "string" ? toolCall.input.script : undefined,
              scriptPath:
                typeof toolCall.input.scriptPath === "string"
                  ? toolCall.input.scriptPath
                  : undefined,
            });
            if (await sessionManager.isWorkflowAllowedForCwd(cwd, preview.meta.name)) {
              return {
                allowed: true,
                inputPatch: {
                  scriptPath: preview.previewScriptPath,
                  script: undefined,
                },
              };
            }
            const decision = await layout.readWorkflowConfirm({
              meta: preview.meta,
              args: toolCall.input.args,
              scriptSource: preview.source,
              scriptPath: preview.previewScriptPath,
              cwd,
            });
            if (decision.action === "cancel") {
              return {
                allowed: false,
                denialReason: "User declined to run the workflow.",
              };
            }
            if (decision.action === "run-always") {
              await sessionManager.allowWorkflowForCwd(cwd, preview.meta.name);
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
        });
      }
      return withAbort(() => layout.readToolApproval({ toolCall, cwd }));
    },
    askUserQuestion: createAskUserQuestionPrompt(layout),
    onReasoningDelta: (sessionId, text) => layout.appendThinking(text, sessionId),
    onReasoningEnd: (sessionId) => layout.endThinkingStream(sessionId),
    onTextDelta: (sessionId, text) => layout.appendAnswer(text, sessionId),
    onAnswerRollback: (sessionId, chars) => layout.rollbackAnswer(chars, sessionId),
    onStreamUsage: (sessionId, usage) => layout.setTurnTokens(usage.outputTokens, sessionId),
    onSubAgentSessionStart: (_parentId, childSessionId, userText) => {
      layout.beginTurnForSession(childSessionId, userText);
    },
    onSubAgentSessionEnd: (_parentId, childSessionId) => {
      layout.finishTurnForSession(childSessionId);
      layout.freezeAgentDetailFooterPin(childSessionId);
    },
    onToolStart: (sessionId, name, toolInput) => {
      if (name === "AskUserQuestion") return;
      layout.beginToolCall(name, summarizeInput(name, toolInput), toolInput, sessionId);
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
        refreshWorkflowUi(sessionId);
      }
    },
    onToolEnd: (sessionId, name, status, error, output, input) => {
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
      layout.finishToolCall(name, status, error, displayOutput, sessionId);
      if (name === "Workflow") {
        refreshWorkflowUi(sessionId);
      }
      if (status === "success" && name === "EnterPlanMode") {
        void syncSessionPermissionMode(sessionId, "plan");
      }
    },
    shouldAbort: (sessionId) => layout.isTurnExitRequestedFor(sessionId),
  });

  session = await harness.runtime.openChatEntrySession();
  layout.setSessionId(session.id);
  layout.refreshHeader();
  await layout.syncInputHistoryFromSession(session.id);
  bindWorkflowSession(session.id);
  if (await sessionHasUserDialogue(session.id)) {
    await layout.loadSessionFromTranscript(session.id);
  }

  const listPromptableInterrupted = async (
    sessionId: string,
  ): Promise<InterruptedBackgroundItem[]> => {
    const items = await listResumableInterrupted(sessionId);
    return items.filter((item) => !dismissedInterruptedIds.has(item.id));
  };

  const resumeOneInterrupted = async (
    sessionId: string,
    item: InterruptedBackgroundItem,
  ): Promise<void> => {
    try {
      if (item.kind === "workflow") {
        const preview = await prepareWorkflowConfirm({
          sessionId,
          cwd: session.cwd,
          name: item.name,
          scriptPath: item.scriptPath,
        });
        const decision = await layout.readWorkflowConfirm({
          meta: preview.meta,
          args: item.args,
          scriptSource: preview.source,
          scriptPath: preview.previewScriptPath,
        });
        if (decision.action === "cancel") {
          await markInterruptedDiscarded(sessionId, item.id);
          layout.appendContent(renderInfo("Interrupted workflow discarded."));
          return;
        }
        await resumeInterruptedWorkflow({
          sessionId,
          cwd: session.cwd,
          item: {
            ...item,
            scriptPath: decision.scriptPath ?? item.scriptPath,
          },
        });
        refreshWorkflowUi(sessionId);
        await markSessionWorkingIfContinuing(sessionId);
        layout.appendContent(renderInfo(`Resumed workflow ${item.name}.`));
        return;
      }

      const summary = formatAgentResumeSummary(item);
      for (const line of summary) layout.appendContent(line);
      const row = await layout.readChoice({
        header: "Interrupted background agent",
        question: "Resume this background agent?",
        rows: buildAgentResumeConfirmRows(),
      });
      const decision = agentResumeDecisionFromRow(row);
      if (decision !== "continue") {
        await markInterruptedDiscarded(sessionId, item.id);
        layout.appendContent(renderInfo("Interrupted agent discarded."));
        return;
      }
      const input = agentInputFromInterrupted(item);
      await harness.runtime.resumeBackgroundAgent(session, input);
      await removeInterruptedItem(sessionId, item.id);
      await markSessionWorkingIfContinuing(sessionId);
      layout.appendContent(renderInfo(`Resumed background agent: ${item.description}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      layout.appendContent(renderError(`Could not resume interrupted task: ${message}`));
    }
  };

  const offerInterruptedResume = async (sessionId: string): Promise<void> => {
    const items = await listPromptableInterrupted(sessionId);
    if (items.length === 0) {
      layout.clearInterruptedResumeHint();
      return;
    }
    layout.armInterruptedResumeHint(
      items.length,
      async () => {
        const next = (await listPromptableInterrupted(sessionId))[0];
        if (!next) {
          layout.clearInterruptedResumeHint();
          return;
        }
        await resumeOneInterrupted(sessionId, next);
        await offerInterruptedResume(sessionId);
      },
      () => {
        for (const item of items) dismissedInterruptedIds.add(item.id);
        layout.clearInterruptedResumeHint();
      },
    );
  };

  void offerInterruptedResume(session.id);
  void recoverUnpresentedWorkflowCompletions(session.id);

  syncSessionPermissionMode = async (
    sessionId: string,
    mode: PermissionMode,
  ): Promise<void> => {
    // Layout footer reflects the visible session only; runtime stores mode per sessionId.
    if (sessionId === session.id) {
      layout.setPermissionMode(mode);
    }
    if (mode === "plan") {
      const meta = await sessionManager.getSessionMeta(sessionId);
      const planPath = await ensurePlanFile(sessionId, meta?.title);
      harness.runtime.setSessionPermissionMode(sessionId, "plan", planPath);
      return;
    }
    harness.runtime.setSessionPermissionMode(sessionId, mode);
  };

  // shift+tab only flips footer/runtime mode — no chat harness turn (Claude Code).
  // Explicit `/plan` still appends Enabled plan mode via the slash handler.
  layout.setPermissionModeChangeHandler((mode) => {
    void syncSessionPermissionMode(session.id, mode);
  });

  layout.setPromoteForegroundAgentHandler(() =>
    harness.runtime.promoteForegroundAgent(session.id),
  );

  const previewForSession = async (sessionId: string): Promise<string> => {
    const interrupted = await listResumableInterrupted(sessionId);
    const cue = interruptedPreviewCue(interrupted);
    if (cue) return cue;

    const memory = new FileMemoryStore(sessionId);
    const transcript = await memory.loadTranscript();
    const fromTx = lastSubstantiveTranscriptPreview(transcript);
    if (fromTx) return fromTx;

    const summary = await sessionManager.loadSessionSummary(sessionId);
    return summaryPreviewLine(summary);
  };

  const answerDurationForSession = async (sessionId: string): Promise<number> => {
    const memory = new FileMemoryStore(sessionId);
    const transcript = await memory.loadTranscript();
    return sessionAnswerDurationMs(transcript);
  };

  const switchChatSession = async (
    nextId: string,
    options?: { announce?: boolean },
  ): Promise<void> => {
    if (nextId !== session.id) {
      debugLog("session:switch", {
        from: session.id,
        to: nextId,
        announce: options?.announce === true,
      });
      layout.parkForegroundSession();
      // Keep completion handlers for the left session — concurrent workflows must
      // still notify that session when they finish.
      session = await harness.runtime.resumeSession(nextId);
      // Stale AI title on an empty transcript (e.g. /clear before this fix) — reset list/header identity.
      if (!(await sessionHasUserDialogue(session.id))) {
        const meta = await sessionManager.getSessionMeta(session.id);
        if (!isDefaultSessionTitle(meta?.title) || (meta?.jobLabel ?? "").trim() || (meta?.jobName ?? "").trim()) {
          session = await sessionManager.clearSessionListIdentity(session.id);
        }
      }
      cwd = session.cwd;
      layout.setSessionId(session.id);
      layout.refreshHeader();
      layout.setPermissionMode(harness.runtime.getSessionPermissionMode(session.id));
      bindWorkflowSession(session.id);
      layout.setSlashInvokableSkills(await listSlashInvokableSkills(cwd));
      if (!layout.restoreParkedSession(session.id)) {
        debugLog("session:loadTranscript", { sessionId: session.id, source: "disk" });
        await layout.loadSessionFromTranscript(session.id);
      } else {
        debugLog("session:restoreParked", { sessionId: session.id });
      }
    } else if (!layout.hasForegroundBlockingOverlay() && !layout.isTurnInProgress()) {
      // Same session, idle — refresh transcript only when not mid-prompt/mid-turn.
      debugLog("session:loadTranscript", { sessionId: session.id, source: "refresh" });
      await layout.loadSessionFromTranscript(session.id);
    }
    await layout.syncInputHistoryFromSession(session.id);
    if (options?.announce) {
      layout.appendContent(renderSessionSwitch(session.id));
    }
    void offerInterruptedResume(session.id);
    void recoverUnpresentedWorkflowCompletions(session.id);
    void flushSessionNotificationQueue(session.id);
  };

  /** Foreground chat while the main loop is blocked on another session's turn/prompt. */
  const runDetachedForegroundLoop = async (): Promise<void> => {
    while (!layout.hasForegroundBlockingOverlay()) {
      if (layout.consumeAppExitRequested()) return;
      if (layout.isAgentsPanelOpen()) {
        await layout.waitForAgentsPanelClosed();
        if (layout.consumeAppExitRequested()) return;
        continue;
      }
      let line: string;
      try {
        line = await layout.readLine({
          placeholder: pickInputPlaceholder(),
        });
      } catch (err) {
        if (err instanceof SessionHandoffError) {
          if (layout.consumeAppExitRequested()) return;
          continue;
        }
        if (err instanceof ExitRequestedError) return;
        throw err;
      }
      const submitLine = line.trimEnd();
      const trimmed = line.trim();
      if (!trimmed) continue;

      const slashLine = line.split("\n")[0]?.trim() ?? "";
      const result = await handleSlashCommand(slashLine, slashCtx());
      // Local slash (e.g. /workflows): already in ↑ input history via readLine commit;
      // do not write a harness turn into the chat timeline.
      const keepLocalSlashInInputHistory = async (): Promise<void> => {
        await refreshInputHistory();
      };
      if (result.type === "exit") return;
      if (result.type === "handled") {
        await keepLocalSlashInInputHistory();
        continue;
      }
      if (result.type === "error") {
        await keepLocalSlashInInputHistory();
        layout.appendContent(renderError(result.message));
        continue;
      }
      if (result.type === "switch") {
        await keepLocalSlashInInputHistory();
        await switchChatSession(result.session.id, { announce: true });
        continue;
      }
      if (result.type === "workflows-panel") {
        await keepLocalSlashInInputHistory();
        await layout.openWorkflowsPanel(session.id);
        continue;
      }
      if (result.type === "clear") {
        await keepLocalSlashInInputHistory();
        await clearSessionConversation(session.id);
        session = await sessionManager.clearSessionListIdentity(session.id);
        layout.clearConversationToCommand(result.displayText);
        layout.refreshHeader();
        continue;
      }
      if (result.type !== "message" && result.type !== "skill-slash") {
        continue;
      }

      const turnSession = session;
      const displayText =
        result.type === "skill-slash" ? result.displayText : submitLine;
      const userTurn = await resolveUserTurnInput(
        turnSession.id,
        result.type === "skill-slash" ? result.displayText : submitLine,
        layout.consumePendingAttachments(displayText),
      );
      userTurn.cliInput = true;
      if (result.type === "skill-slash") {
        const slashContent = await resolveSkillSlashUserContent(
          result.name,
          result.args,
          result.handler,
          cwd,
        );
        if (slashContent.mode === "blocks") {
          userTurn.llmBlocks = slashContent.blocks;
        } else {
          userTurn.llmText = slashContent.text;
        }
      }
      const transcriptCountBefore = await getTranscriptLength(turnSession.id);
      layout.beginTurn(userTurn.text.trim() || displayText);
      try {
        await harness.runtime.runTurn(turnSession, userTurn);
      } catch (err) {
        if (err instanceof ExitRequestedError) return;
        if (!(err instanceof TurnAbortedError)) throw err;
      } finally {
        await finalizeActiveTurn(transcriptCountBefore, turnSession);
      }
    }
  };

  layout.setRewindHandlers({
    loadTurns: async () => {
      const memory = new FileMemoryStore(session.id);
      return rewindTurnsFromTranscript(await memory.loadTranscript());
    },
    restore: async (anchor) => {
      await truncateSessionTranscript(session.id, anchor.transcriptIndex);
      await layout.loadSessionFromTranscript(session.id);
      await refreshInputHistory();
      // Prefill happens after Rewind closes (submitRewindSelection) so the chat
      // input footer paints the restored prompt instead of leaving a blank chrome.
    },
    restoreCode: async (anchor) => {
      const memory = new FileMemoryStore(session.id);
      const transcript = await memory.loadTranscript();
      const result = await restoreCodeChangesFromTranscript(transcript, anchor.transcriptIndex);
      if (result.errors.length > 0) {
        layout.appendContent(
          renderError(`Code restore partial: ${result.errors.slice(0, 3).join("; ")}`),
        );
      }
    },
    summarize: async (mode, anchor, context) => {
      await summarizeTranscriptRange({
        sessionId: session.id,
        selectedUserIndex: anchor.transcriptIndex,
        mode,
        context,
      });
      await layout.loadSessionFromTranscript(session.id);
      await refreshInputHistory();
    },
  });

  layout.setAgentsPanelHandlers({
    entryCwd: () => {
      agentsEntryCwd = cwd;
      return agentsEntryCwd;
    },
    modelLabel: () => {
      const active = getActiveProvider(registry);
      return getProviderModelLabel(active.profile, active.model);
    },
    agentName: () => definition.name,
    version: KAKO_CORE_VERSION,
    loadSessions: () => sessionManager.listSessionMetas({ limit: 100 }),
    loadBgTasks: () =>
      listBackgroundTasks(session.id).filter((t) => t.kind === "agent" && !t.stopped),
    loadRunningBgSessionIds: () => sessionsWithRunningBackgroundWork(),
    loadInterruptedSessionIds: async () => {
      const metas = await sessionManager.listSessionMetas({ limit: 100 });
      const ids = new Set<string>();
      await Promise.all(
        metas.map(async (m) => {
          if (m.parentSessionId) return;
          const items = await listResumableInterrupted(m.id);
          if (items.length > 0) ids.add(m.id);
        }),
      );
      return ids;
    },
    previewForSession,
    answerDurationForSession,
    onOpenSession: async (id) => {
      const fromId = session.id;
      const fromBlocked =
        layout.hasForegroundBlockingOverlay() || layout.isTurnInProgress();
      await switchChatSession(id);
      if (id !== fromId && fromBlocked) {
        layout.setAfterAgentsClose(async () => {
          await flushSessionNotificationQueue(session.id);
          await runDetachedForegroundLoop();
        });
      }
    },
    onCreateSession: async (text) => {
      harness.runtime.setCwd(agentsEntryCwd);
      try {
        const created = await harness.runtime.createSession();
        ensureSessionLifecycle(created.id);
        const userTurn = await resolveUserTurnInput(created.id, text, []);
        userTurn.cliInput = true;
        layout.beginTurnForSession(created.id, userTurn.text.trim() || text);
        // Run in background so Agents stays interactive and Working updates promptly.
        void harness.runtime
          .runTurn(created, userTurn)
          .catch((err) => {
            if (!(err instanceof ExitRequestedError) && !(err instanceof TurnAbortedError)) {
              layout.appendContent(renderError(err instanceof Error ? err.message : String(err)));
            }
          })
          .finally(() => {
            if (!layout.applyAgentsTurnAbortCleanup()) {
              layout.finishTurnForSession(created.id);
            }
            if (layout.isAgentsPanelOpen()) {
              void layout.refreshAgentsSessionPreview(created.id);
            }
          });
        return created.id;
      } finally {
        harness.runtime.setCwd(cwd);
      }
    },
    onDeleteSession: async (id) => {
      const wasCurrent = id === session.id;
      layout.dropParkedSession(id);
      dropSessionLifecycle(id);
      await sessionManager.deleteSession(id);
      if (!wasCurrent) return;
      const remaining = (await sessionManager.listSessionMetas({ limit: 100 })).filter(
        (m) => m.status === "active",
      );
      if (remaining[0]) {
        // Avoid parking a deleted session: clear local transcript UI then switch.
        layout.setSessionId(remaining[0].id);
        session = await harness.runtime.resumeSession(remaining[0].id);
        cwd = session.cwd;
        layout.setPermissionMode(harness.runtime.getSessionPermissionMode(session.id));
        bindWorkflowSession(session.id);
        layout.setSlashInvokableSkills(await listSlashInvokableSkills(cwd));
        await layout.loadSessionFromTranscript(session.id);
        await layout.syncInputHistoryFromSession(session.id);
        return;
      }
      harness.runtime.setCwd(agentsEntryCwd);
      session = await harness.runtime.createSession();
      cwd = session.cwd;
      layout.setSessionId(session.id);
      layout.setPermissionMode(harness.runtime.getSessionPermissionMode(session.id));
      await layout.syncInputHistoryFromSession(session.id);
      bindWorkflowSession(session.id);
    },
    onReplySession: async (id, text) => {
      const target = await sessionManager.getSession(id);
      if (!target) return;
      try {
        // Sending a reply adopts the target as the chat "current session".
        // Opening reply mode alone must not switch — only this send path does.
        let needsDetachedAfterAgents = false;
        if (id !== session.id) {
          const fromId = session.id;
          const fromBlocked =
            layout.hasForegroundBlockingOverlay() || layout.isTurnInProgress();
          await switchChatSession(id);
          needsDetachedAfterAgents = id !== fromId && fromBlocked;
        }

        // Interrupted sessions show Needs input because process-exit left a checkpoint.
        // A freestanding Agents reply turn cannot resume soft-journal work and often
        // ends as Done · 0s. Route through the same approval resume as Enter-on-hint.
        const interruptedItems = await listPromptableInterrupted(session.id);
        if (agentsReplyShouldResumeInterrupted(interruptedItems.length)) {
          const interruptedItem = interruptedItems[0]!;
          layout.setAfterAgentsClose(null);
          layout.clearInterruptedResumeHint();
          layout.dismissAgentsPanel();
          await resumeOneInterrupted(session.id, interruptedItem);
          await offerInterruptedResume(session.id);
          if ((await listPromptableInterrupted(session.id)).length === 0) {
            return;
          }
          // User cancelled resume — fall through to a normal chat turn with their text.
        } else if (needsDetachedAfterAgents) {
          layout.setAfterAgentsClose(async () => {
            await flushSessionNotificationQueue(session.id);
            await runDetachedForegroundLoop();
          });
        }

        ensureSessionLifecycle(session.id);
        const userTurn = await resolveUserTurnInput(session.id, text, []);
        userTurn.cliInput = true;
        layout.beginTurnForSession(session.id, userTurn.text.trim() || text);
        const turnSession = session;
        // Do not await here — Agents input (incl. Ctrl+C) must stay responsive.
        void harness.runtime
          .runTurn(turnSession, userTurn)
          .catch((err) => {
            if (!(err instanceof ExitRequestedError) && !(err instanceof TurnAbortedError)) {
              layout.appendContent(renderError(err instanceof Error ? err.message : String(err)));
            }
          })
          .finally(() => {
            if (!layout.applyAgentsTurnAbortCleanup()) {
              layout.finishTurnForSession(turnSession.id);
            }
            if (layout.isAgentsPanelOpen()) {
              void layout.refreshAgentsSessionPreview(turnSession.id);
            }
          });
      } finally {
        harness.runtime.setCwd(cwd);
      }
    },
    onAgentsClosed: async () => {
      await flushSessionNotificationQueue(session.id);
    },
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

  let restoreInput: string | undefined;

  const finalizeActiveTurn = async (
    transcriptCountBefore: number,
    turnSession: Session = session,
  ): Promise<"continue" | "exit"> => {
    await flushSessionNotificationQueue(session.id);
    if (layout.consumeAppExitRequested()) {
      debugStack("finalizeActiveTurn:exit:appExit", {
        sessionId: turnSession.id,
      });
      await truncateSessionTranscript(turnSession.id, transcriptCountBefore);
      layout.discardActiveTurn();
      await refreshInputHistory();
      return "exit";
    }
    const restore = layout.consumeTurnRestoreInput();
    if (layout.consumeTurnDiscardOnAbort()) {
      await truncateSessionTranscript(turnSession.id, transcriptCountBefore);
      layout.discardActiveTurn();
      if (restore) restoreInput = restore;
    } else {
      layout.finishTurn();
    }
    await refreshInputHistory();
    return "continue";
  };

  debugLog("chatLoop:start", {
    logPath: getCliDebugLogPath(),
    cwd,
    pid: process.pid,
    sessionId: session.id,
  });

  try {
    chatLoop: while (true) {
      if (layout.consumeAppExitRequested()) {
        debugLog("chatLoop:break:appExit:loopTop");
        break chatLoop;
      }
      await syncProviderFromDisk();
      if (layout.consumeAppExitRequested()) {
        debugLog("chatLoop:break:appExit:afterSyncProvider");
        break chatLoop;
      }
      if (layout.isAgentsPanelOpen()) {
        await layout.waitForAgentsPanelClosed();
        if (layout.consumeAppExitRequested()) {
          debugLog("chatLoop:break:appExit:afterAgentsClose");
          break chatLoop;
        }
        continue;
      }
      let line: string;
      try {
        line = await layout.readLine({
          placeholder: pickInputPlaceholder(),
          initialValue: restoreInput,
        });
      } catch (err) {
        if (err instanceof SessionHandoffError) {
          debugLog("chatLoop:SessionHandoffError", {
            message: err.message,
          });
          if (layout.consumeAppExitRequested()) {
            debugLog("chatLoop:break:appExit:afterHandoff");
            break chatLoop;
          }
          continue;
        }
        if (err instanceof ExitRequestedError) {
          debugStack("chatLoop:break:ExitRequestedError:fromReadLine");
          break chatLoop;
        }
        debugLog("chatLoop:readLineThrow", {
          err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8).join(" | ") : undefined,
        });
        throw err;
      }
      restoreInput = undefined;
      debugLog("chatLoop:gotLine", {
        preview: line.slice(0, 120),
        len: line.length,
      });
      await flushSessionNotificationQueue(session.id);

      const trimmed = line.trim();
      if (!trimmed) {
        debugLog("chatLoop:emptyLine:continue");
        continue;
      }

      const submitLine = line.trimEnd();
      let slashLine = line.split("\n")[0]?.trim() ?? "";
      const barePlanMatch = trimmed.match(/^plan(?:\s+(.*))?$/i);
      if (barePlanMatch && !trimmed.startsWith("/")) {
        slashLine = barePlanMatch[1] ? `/plan ${barePlanMatch[1]}` : "/plan";
      }

      const result = await handleSlashCommand(slashLine, slashCtx());
      // Local slash (e.g. /workflows): keep ↑ input history only — not the chat timeline.
      const keepLocalSlashInInputHistory = async (): Promise<void> => {
        await refreshInputHistory();
      };

      debugLog("chatLoop:slashResult", { type: result.type });
      switch (result.type) {
        case "exit":
          debugLog("chatLoop:slash:exit:fallthrough");
          break;
        case "handled": {
          await keepLocalSlashInInputHistory();
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
          await keepLocalSlashInInputHistory();
          layout.appendContent(renderError(result.message));
          continue;
        case "switch":
          await keepLocalSlashInInputHistory();
          await switchChatSession(result.session.id, { announce: true });
          continue;
        case "workflows-panel":
          await keepLocalSlashInInputHistory();
          await layout.openWorkflowsPanel(session.id);
          continue;
        case "clear":
          await keepLocalSlashInInputHistory();
          await clearSessionConversation(session.id);
          session = await sessionManager.clearSessionListIdentity(session.id);
          layout.clearConversationToCommand(result.displayText);
          layout.refreshHeader();
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
              await syncSessionPermissionMode(session.id, "plan");
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
            await syncSessionPermissionMode(session.id, "plan");
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
                layout.appendContent(
                  renderError(err instanceof Error ? err.message : String(err)),
                );
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
        case "auto-enter": {
          await syncSessionPermissionMode(session.id, "bypassPermissions");
          layout.beginTurn(result.displayText);
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
                // stay in chat
              } else {
                layout.appendContent(
                  renderError(err instanceof Error ? err.message : String(err)),
                );
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
        case "manual-enter": {
          await syncSessionPermissionMode(session.id, "default");
          layout.beginTurn(result.displayText);
          layout.finishHarnessTurn();
          await refreshInputHistory();
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
              layout.appendContent(
                renderError(err instanceof Error ? err.message : String(err)),
              );
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
          debugLog("chatLoop:message:runTurn:start", {
            preview: submitLine.slice(0, 120),
            sessionId: session.id,
          });
          try {
            await harness.runtime.runTurn(session, userTurn);
            debugLog("chatLoop:message:runTurn:ok", { sessionId: session.id });
          } catch (err) {
            if (err instanceof ExitRequestedError) {
              debugStack("chatLoop:break:ExitRequestedError:fromRunTurn");
              break chatLoop;
            }
            if (err instanceof TurnAbortedError) {
              debugLog("chatLoop:message:TurnAbortedError", { sessionId: session.id });
              // finalizeActiveTurn discards or restores the prompt; stay in chat.
            } else {
              debugError("chatLoop:message:runTurnError:stayInChat", {
                sessionId: session.id,
                err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
                stack:
                  err instanceof Error
                    ? err.stack?.split("\n").slice(0, 10).join(" | ")
                    : undefined,
              });
              layout.appendContent(
                renderError(err instanceof Error ? err.message : String(err)),
              );
            }
          } finally {
            if ((await finalizeActiveTurn(transcriptCountBefore)) === "exit") {
              debugLog("chatLoop:break:finalizeActiveTurn:exit");
              break chatLoop;
            }
          }
          continue;
        }
      }
    }
    debugLog("chatLoop:exitedWhile");
  } finally {
    debugStack("chatLoop:finally:farewell");
    for (const id of [...lifecycleBoundSessions]) {
      dropSessionLifecycle(id);
    }
    // Persist interrupted checkpoints before quitting so restart shows Needs input.
    try {
      await checkpointBackgroundWorkForProcessExit();
    } catch {
      // Best-effort — still allow clean teardown.
    }
    if (session.status !== "ended") {
      const meta = await sessionManager.getSessionMeta(session.id);
      const resumable = (await listResumableInterrupted(session.id)).length > 0;
      const leaveForNeedsInput =
        resumable ||
        meta?.agentState?.state === "blocked" ||
        meta?.agentState?.state === "working";
      if (!leaveForNeedsInput) {
        await harness.runtime.endSession(session);
      }
    }
    layout.stop();
    console.log(renderFarewell());
    if (isCliDebugEnabled()) {
      console.error(`[kako] debug log: ${getCliDebugLogPath()}`);
    }
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
  if (name === "Read" && (input.file_path || input.path)) {
    return formatReadDisplayDetail(String(input.file_path ?? input.path), input);
  }
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  if (input.skill) return String(input.skill);
  if (input.command) return String(input.command).slice(0, 60);
  if (input.description) return String(input.description).slice(0, 80);
  return JSON.stringify(input).slice(0, 60);
}
