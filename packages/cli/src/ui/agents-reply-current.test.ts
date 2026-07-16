import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "@kako/shared";
import { createAgentsPanelState, refreshAgentsPanelRows } from "./agents-panel.js";
import { ChatLayout } from "./terminal-layout.js";
import { renderInitialInputFooter } from "./welcome.js";

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
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
      sessionId: "sess-entry",
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
};

describe("Agents reply adopts current session", () => {
  it("updates entrySessionId only after a reply is sent", async () => {
    const layout = testLayout();
    layout.setSessionId("sess-entry");
    const metas = [
      meta({ id: "sess-entry", cwd: "/tmp", title: "entry" }),
      meta({ id: "sess-other", cwd: "/tmp", title: "你好问候会话" }),
    ];
    const onReplySession = vi.fn(async () => {});
    const onOpenSession = vi.fn(async () => {});

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
      onOpenSession,
      onCreateSession: async () => "new",
      onDeleteSession: async () => {},
      onReplySession,
    };
    internals.agentsPanelMetas = metas;
    internals.agentsPanelState = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "sess-entry",
      modelLabel: "test",
      agentName: "main",
      version: "0.0.0",
      metas,
      previews: { "sess-entry": "a", "sess-other": "b" },
      preferredSessionId: "sess-other",
    });
    internals.readingAgentsPanel = true;

    // Space → reply mode on selected other session (already preferred/selected).
    await internals.handleAgentsPanelInput(" ");
    expect(internals.agentsPanelState.mode).toBe("reply");
    expect(internals.agentsPanelState.replySessionId).toBe("sess-other");
    expect(internals.agentsPanelState.entrySessionId).toBe("sess-entry");

    // Close reply without sending — current session must stay on entry.
    await internals.handleAgentsPanelInput(" ");
    expect(internals.agentsPanelState.mode).toBe("list");
    expect(internals.agentsPanelState.entrySessionId).toBe("sess-entry");

    // Re-enter reply and send.
    await internals.handleAgentsPanelInput(" ");
    await internals.handleAgentsPanelInput("你好");
    await internals.handleAgentsPanelInput("\r");

    expect(onReplySession).toHaveBeenCalledWith("sess-other", "你好");
    expect(internals.agentsPanelState.entrySessionId).toBe("sess-other");
    const otherRow = internals.agentsPanelState.rows.find(
      (r) => r.kind === "session" && r.sessionId === "sess-other",
    );
    expect(otherRow).toMatchObject({ title: "current session" });
    const entryRow = internals.agentsPanelState.rows.find(
      (r) => r.kind === "session" && r.sessionId === "sess-entry",
    );
    expect(entryRow).toMatchObject({ title: "entry" });
    // Reply must not close Agents / call open (enter-to-open path).
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(layout.isAgentsPanelOpen()).toBe(true);
  });

  it("refreshAgentsPanelRows picks up a new entrySessionId label", () => {
    const metas = [
      meta({ id: "a", cwd: "/tmp", title: "Alpha" }),
      meta({ id: "b", cwd: "/tmp", title: "Beta" }),
    ];
    let state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "a",
      modelLabel: "m",
      version: "0",
      metas,
    });
    expect(
      state.rows.find((r) => r.kind === "session" && r.sessionId === "a"),
    ).toMatchObject({ title: "current session" });

    state = refreshAgentsPanelRows({ ...state, entrySessionId: "b" }, metas);
    expect(
      state.rows.find((r) => r.kind === "session" && r.sessionId === "b"),
    ).toMatchObject({ title: "current session" });
    expect(
      state.rows.find((r) => r.kind === "session" && r.sessionId === "a"),
    ).toMatchObject({ title: "Alpha" });
  });
});
