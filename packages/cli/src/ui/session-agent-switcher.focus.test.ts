import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  registerBackgroundTask,
  resetBackgroundTaskStore,
} from "@kako/core";
import { ChatLayout } from "./terminal-layout.js";
import { renderInitialInputFooter } from "./welcome.js";
import { canManageSessionAgents } from "./session-agent-switcher.js";

function testLayout(): ChatLayout {
  return new ChatLayout(
    () => ({
      version: "0.0.0",
      agentName: "main",
      modelLabel: "test",
      cwd: "/tmp",
      sessionId: "sess-main",
      sessionLabel: "main",
      dataDir: "/tmp",
    }),
    renderInitialInputFooter(),
  );
}

type LayoutPriv = {
  sessionId: string;
  agentSwitcherFocus: "input" | "list";
  agentSwitcherSelected: number;
  agentDetailSnapshot: unknown;
  sessionHasManageableAgents: () => boolean;
  focusAgentList: () => void;
  blurAgentListToInput: () => void;
  handleAgentListAction: (action: { type: string; char?: string }) => Promise<boolean>;
  closeAgentDetail: () => void;
};

describe("footer agent switcher focus", () => {
  beforeEach(() => {
    resetBackgroundTaskStore();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    resetBackgroundTaskStore();
    vi.restoreAllMocks();
  });

  it("reports manageable agents from live agent BG tasks", () => {
    const layout = testLayout();
    const priv = layout as unknown as LayoutPriv;
    priv.sessionId = "sess-main";
    expect(priv.sessionHasManageableAgents()).toBe(false);

    registerBackgroundTask("sess-main", "t1", "agent", () => {}, {
      subagentName: "Explore",
      description: "find auth",
      childSessionId: "child-1",
    });
    expect(priv.sessionHasManageableAgents()).toBe(true);
    expect(canManageSessionAgents([{
      id: "t1",
      sessionId: "sess-main",
      kind: "agent",
      startedAt: new Date().toISOString(),
      stopped: false,
      abort: () => {},
    }])).toBe(true);
  });

  it("treats foreground blocking Explore as manageable for footer list", () => {
    const layout = testLayout();
    const priv = layout as unknown as LayoutPriv;
    priv.sessionId = "sess-main";
    registerBackgroundTask("sess-main", "fg", "agent", () => {}, {
      subagentName: "Explore",
      description: "scan llm",
      blocking: true,
      childSessionId: "child-fg",
    });
    expect(priv.sessionHasManageableAgents()).toBe(true);
  });

  it("↓ focuses list; ↑ on first row returns to input; x stops subagent", async () => {
    const layout = testLayout();
    const priv = layout as unknown as LayoutPriv;
    priv.sessionId = "sess-main";
    registerBackgroundTask("sess-main", "t1", "agent", () => {}, {
      subagentName: "Explore",
      description: "find auth",
      childSessionId: "child-1",
    });

    priv.focusAgentList();
    expect(priv.agentSwitcherFocus).toBe("list");
    expect(priv.agentSwitcherSelected).toBe(0); // > ● main

    await priv.handleAgentListAction({ type: "historyDown" });
    expect(priv.agentSwitcherSelected).toBe(1); // > ○ Explore

    await priv.handleAgentListAction({ type: "historyUp" });
    expect(priv.agentSwitcherFocus).toBe("list");
    expect(priv.agentSwitcherSelected).toBe(0); // > ● main

    await priv.handleAgentListAction({ type: "historyUp" });
    expect(priv.agentSwitcherFocus).toBe("input"); // back to input caret

    priv.focusAgentList();
    await priv.handleAgentListAction({ type: "historyDown" });
    await priv.handleAgentListAction({ type: "char", char: "x" });
    expect(priv.agentSwitcherFocus).toBe("input");
    expect(priv.sessionHasManageableAgents()).toBe(false);
  });

  it("prioritizes detail pop over Agents on ←", async () => {
    const layout = testLayout();
    const priv = layout as unknown as LayoutPriv;
    priv.sessionId = "sess-main";
    priv.agentDetailSnapshot = {
      turns: [],
      activeTurn: null,
      plainLines: [],
      tipText: null,
      scrollOffset: 0,
      followBottom: true,
    };
    priv.closeAgentDetail();
    expect(priv.agentDetailSnapshot).toBeNull();
  });

  it("keeps footer agent switcher while viewing a finished Explore detail", () => {
    const layout = testLayout();
    const priv = layout as unknown as LayoutPriv & {
      agentDetailChildSessionId: string | null;
      agentDetailFooterPin: {
        kind: "subagent";
        taskId: string;
        name: string;
        description: string;
        startedAt: string;
        childSessionId: string;
      } | null;
      sessionAgentRows: () => Array<{ kind: string; label?: string; name?: string }>;
      sessionHasManageableAgents: () => boolean;
    };
    priv.sessionId = "sess-main";
    // No live background tasks (completeBackgroundTask already deleted Explore).
    priv.agentDetailChildSessionId = "child-done";
    priv.agentDetailFooterPin = {
      kind: "subagent",
      taskId: "t-done",
      name: "Explore",
      description: "scan llm",
      startedAt: "2026-07-15T00:00:00.000Z",
      childSessionId: "child-done",
    };

    expect(priv.sessionHasManageableAgents()).toBe(true);
    const rows = priv.sessionAgentRows();
    expect(rows.map((r) => (r.kind === "main" ? r.label : r.name))).toEqual([
      "main",
      "Explore",
    ]);
  });
});
