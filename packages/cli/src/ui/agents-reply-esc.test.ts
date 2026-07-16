import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "@kako/shared";
import { createAgentsPanelState } from "./agents-panel.js";
import { ChatLayout } from "./terminal-layout.js";
import { renderInitialInputFooter } from "./welcome.js";

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function meta(partial: Partial<SessionMeta> & Pick<SessionMeta, "id" | "cwd">): SessionMeta {
  return {
    projectId: "proj-x",
    agentName: "main",
    title: "new session",
    status: "active",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T01:00:00.000Z",
    ...partial,
  };
}

function testLayout(): ChatLayout {
  return new ChatLayout(
    () => ({
      version: "0.0.0",
      agentName: "main",
      modelLabel: "test",
      cwd: "/tmp",
      sessionId: "sess-1",
      sessionLabel: "main",
      dataDir: "/tmp",
    }),
    renderInitialInputFooter(),
  );
}

type LayoutInternals = {
  readingAgentsPanel: boolean;
  agentsPanelState: ReturnType<typeof createAgentsPanelState>;
  agentsPanelMetas: SessionMeta[];
  agentsPanelHandlers: unknown;
  handleAgentsPanelInput: (chunk: string) => Promise<void>;
  handleAgentsPanelEscapeKey: () => Promise<"continue" | "close">;
  turnExitRequested: boolean;
  turnDiscardOnAbort: boolean;
  turnRestoreInput: string | null;
};

describe("Agents reply Esc pauses in-flight turn", () => {
  it("Esc during reply generation requests turn cancel instead of leaving reply mode", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-1");
    const metas = [meta({ id: "sess-1", cwd: "/tmp", title: "current" })];
    const internals = layout as unknown as LayoutInternals;
    internals.agentsPanelHandlers = {
      entryCwd: () => "/tmp",
      modelLabel: () => "test",
      agentName: () => "main",
      version: "0.0.0",
      loadSessions: async () => metas,
      loadBgTasks: () => [],
      loadRunningBgSessionIds: () => new Set<string>(),
      loadInterruptedSessionIds: async () => new Set<string>(),
      previewForSession: async () => "preview",
      answerDurationForSession: async () => 0,
      onOpenSession: async () => {},
      onCreateSession: async () => "new",
      onDeleteSession: async () => {},
      onReplySession: async () => {},
    };
    internals.agentsPanelMetas = metas;
    internals.agentsPanelState = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "sess-1",
      modelLabel: "test",
      agentName: "main",
      version: "0.0.0",
      metas,
      previews: { "sess-1": "a" },
    });
    internals.readingAgentsPanel = true;

    await internals.handleAgentsPanelInput(" ");
    await internals.handleAgentsPanelInput("帮我写一份早教的报告");
    await internals.handleAgentsPanelInput("\r");
    expect(internals.agentsPanelState.mode).toBe("reply");
    expect(internals.agentsPanelState.replyContext).toBe("帮我写一份早教的报告");

    layout.beginTurnForSession("sess-1", "帮我写一份早教的报告");
    expect(layout.isTurnInProgress()).toBe(true);

    // Lone ESC is buffered then flushed into Agents escape handler.
    await internals.handleAgentsPanelInput("\u001b");
    await vi.advanceTimersByTimeAsync(40);

    expect(internals.turnExitRequested).toBe(true);
    expect(internals.turnDiscardOnAbort).toBe(true);
    expect(internals.turnRestoreInput).toBe("帮我写一份早教的报告");
    expect(internals.agentsPanelState.mode).toBe("reply");
  });

  it("Esc with empty reply and no turn still leaves reply mode", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-1");
    const metas = [meta({ id: "sess-1", cwd: "/tmp", title: "current" })];
    const internals = layout as unknown as LayoutInternals;
    internals.agentsPanelHandlers = {
      entryCwd: () => "/tmp",
      modelLabel: () => "test",
      agentName: () => "main",
      version: "0.0.0",
      loadSessions: async () => metas,
      loadBgTasks: () => [],
      loadRunningBgSessionIds: () => new Set<string>(),
      loadInterruptedSessionIds: async () => new Set<string>(),
      previewForSession: async () => "preview",
      answerDurationForSession: async () => 0,
      onOpenSession: async () => {},
      onCreateSession: async () => "new",
      onDeleteSession: async () => {},
      onReplySession: async () => {},
    };
    internals.agentsPanelMetas = metas;
    internals.agentsPanelState = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "sess-1",
      modelLabel: "test",
      version: "0.0.0",
      metas,
    });
    internals.readingAgentsPanel = true;
    await internals.handleAgentsPanelInput(" ");
    expect(internals.agentsPanelState.mode).toBe("reply");

    expect(await internals.handleAgentsPanelEscapeKey()).toBe("continue");
    expect(internals.agentsPanelState.mode).toBe("list");
  });

  it("applyAgentsTurnAbortCleanup restores draft into reply box", () => {
    const layout = testLayout();
    layout.setSessionId("sess-1");
    const metas = [meta({ id: "sess-1", cwd: "/tmp", title: "current" })];
    const internals = layout as unknown as LayoutInternals;
    internals.readingAgentsPanel = true;
    internals.agentsPanelMetas = metas;
    internals.agentsPanelState = {
      ...createAgentsPanelState({
        entryCwd: "/tmp",
        entrySessionId: "sess-1",
        modelLabel: "test",
        version: "0.0.0",
        metas,
      }),
      mode: "reply",
      replySessionId: "sess-1",
      replyContext: "帮我写一份早教的报告",
      replyBuffer: "",
      replyCursor: 0,
      composeFocus: true,
    };
    layout.beginTurnForSession("sess-1", "帮我写一份早教的报告");
    layout.requestTurnCancelForEdit();

    expect(layout.applyAgentsTurnAbortCleanup()).toBe(true);
    expect(internals.agentsPanelState.mode).toBe("reply");
    expect(internals.agentsPanelState.replyBuffer).toBe("帮我写一份早教的报告");
    expect(internals.agentsPanelState.replyContext).toBeUndefined();
    expect(layout.isTurnInProgress()).toBe(false);
  });
});
