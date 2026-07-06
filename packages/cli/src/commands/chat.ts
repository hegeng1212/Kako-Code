import {
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
  loadAgent,
  loadGlobalUserContext,
  loadProjectContext,
  loadProviderRegistry,
  planFilePathForSession,
  readPlanFile,
  resolveUserTurnInput,
  sessionManager,
  TurnAbortedError,
} from "@kako/core";
import type { PermissionMode, Session, SlashCommandContext, ToolConfirmResult } from "@kako/shared";
import { getProviderModelLabel } from "@kako/shared";
import { resolve } from "node:path";
import { guideProviderSetup } from "../ui/setup-guide.js";
import { createAskUserQuestionPrompt } from "../ui/ask-user-question.js";
import { isPlanFileDetail } from "../ui/tool-call-phrases.js";
import { ChatLayout, ExitRequestedError } from "../ui/terminal-layout.js";
import {
  renderError,
  renderFarewell,
  renderInfo,
  renderInitialInputFooter,
  renderSessionSwitch,
  renderWelcomeScreen,
  type WelcomeScreenOptions,
} from "../ui/welcome.js";

export async function runChat(cwdArg: string): Promise<void> {
  const cwd = resolve(cwdArg);
  await initializeKakoHome();
  let registry = await loadProviderRegistry();
  const readiness = checkProviderReadiness(registry);
  if (!readiness.ready) {
    await guideProviderSetup(readiness);
    registry = await loadProviderRegistry();
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

  layout = new ChatLayout(() => renderWelcomeScreen(welcomeOpts()), footer);
  layout.start();

  const syncProviderFromDisk = async (): Promise<void> => {
    registry = await loadProviderRegistry();
    layout.refreshHeader();
  };

  const harness = await createHarness({
    cwd,
    confirm: async (toolCall): Promise<ToolConfirmResult> => {
      if (toolCall.name === "ExitPlanMode") {
        const planPath = planFilePathForSession(session.id);
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
      const allowed = await layout.readConfirm(
        `Allow ${toolCall.name}(${summarizeInput(toolCall.input)})? [y/N] `,
      );
      return allowed;
    },
    askUserQuestion: createAskUserQuestionPrompt(layout),
    onReasoningDelta: (text) => layout.appendThinking(text),
    onReasoningEnd: () => layout.endThinkingStream(),
    onTextDelta: (text) => layout.appendAnswer(text),
    onAnswerRollback: (chars) => layout.rollbackAnswer(chars),
    onStreamUsage: (usage) => layout.setTurnTokens(usage.outputTokens),
    onToolStart: (name, toolInput) => {
      if (name === "AskUserQuestion") return;
      layout.beginToolCall(name, summarizeInput(toolInput));
    },
    onToolEnd: (name, status, error, output, input) => {
      if (name === "AskUserQuestion") return;
      let displayOutput = output;
      if (
        status === "success" &&
        (name === "Write" || name === "Edit") &&
        input
      ) {
        const detail = summarizeInput(input);
        if (isPlanFileDetail(detail)) {
          if (name === "Write" && (typeof input.content === "string" || typeof input.contents === "string")) {
            displayOutput = String(input.content ?? input.contents);
          } else {
            const planPath = String(input.file_path ?? input.path ?? detail);
            void readPlanFile(planPath).then((text) => {
              if (text) layout.updateLastToolOutput(text);
            });
          }
        }
      }
      layout.finishToolCall(name, status, error, displayOutput);
      if (status === "success" && name === "EnterPlanMode") {
        void syncSessionPermissionMode("plan");
      }
    },
    shouldAbort: () => layout.consumeTurnExitRequested(),
  });

  session = await harness.runtime.createSession();
  layout.setSessionId(session.id);

  syncSessionPermissionMode = async (mode: PermissionMode): Promise<void> => {
    layout.setPermissionMode(mode);
    if (mode === "plan") {
      const planPath = await ensurePlanFile(session.id);
      harness.runtime.setSessionPermissionMode("plan", planPath);
      return;
    }
    harness.runtime.setSessionPermissionMode(mode);
  };

  layout.setPermissionModeChangeHandler((mode) => {
    void syncSessionPermissionMode(mode);
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

  try {
    while (true) {
      await syncProviderFromDisk();
      let line: string;
      try {
        line = await layout.readLine({
          placeholder: firstPrompt ? 'Try "explain this codebase"' : undefined,
          plain: !firstPrompt,
        });
      } catch (err) {
        if (err instanceof ExitRequestedError) break;
        throw err;
      }
      firstPrompt = false;

      const trimmed = line.trim();
      if (!trimmed) continue;

      const result = await handleSlashCommand(trimmed, slashCtx());

      switch (result.type) {
        case "exit":
          break;
        case "handled": {
          if (trimmed === "/help" || trimmed.startsWith("/help ")) {
            layout.appendContent(formatSlashHelp());
          } else if (trimmed === "/sessions" || trimmed.startsWith("/sessions ")) {
            const sessions = await sessionManager.listSessions({ cwd });
            layout.appendContent(await formatSessionList(sessions));
          } else if (trimmed.startsWith("/title")) {
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
          session = result.session;
          layout.setSessionId(session.id);
          layout.appendContent(renderSessionSwitch(session.id));
          continue;
        case "message": {
          const userTurn = await resolveUserTurnInput(
            session.id,
            trimmed,
            layout.consumePendingAttachments(trimmed),
          );
          layout.beginTurn(userTurn.text.trim() || trimmed);
          try {
            await harness.runtime.runTurn(session, userTurn);
          } catch (err) {
            if (err instanceof ExitRequestedError || err instanceof TurnAbortedError) break;
            throw err;
          } finally {
            layout.finishTurn();
          }
          continue;
        }
      }
    }
  } finally {
    if (session.status !== "ended") {
      await harness.runtime.endSession(session);
    }
    layout.stop();
    console.log(renderFarewell());
  }
}

function summarizeInput(input: Record<string, unknown>): string {
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  if (input.skill) return String(input.skill);
  if (input.command) return String(input.command).slice(0, 60);
  if (input.description) return String(input.description).slice(0, 80);
  return JSON.stringify(input).slice(0, 60);
}
