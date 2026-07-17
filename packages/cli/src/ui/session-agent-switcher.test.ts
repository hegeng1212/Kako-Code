import { describe, expect, it } from "vitest";
import type { BackgroundTask } from "@kako/core";
import { stripAnsi } from "./ansi.js";
import {
  agentListShortcutsHint,
  buildSessionAgentRows,
  buildSessionAgentRowsWithDetailPin,
  canManageSessionAgents,
  countBackgroundWaitingAgents,
  currentSessionAgentIndex,
  focusAfterListUp,
  focusFromInputDown,
  listManageableAgentTasks,
  moveAgentSelection,
  renderSessionAgentListLines,
  resolveAgentDetailPinRow,
  shouldFocusAgentListAfterLeavingHistory,
  shouldOpenAgentsOnCursorLeft,
  shouldPopAgentDetailOnLeft,
  shouldShowChatInputCaret,
  subagentElapsedMs,
  type SessionSubagentRow,
} from "./session-agent-switcher.js";

function agentTask(partial: Partial<BackgroundTask> & Pick<BackgroundTask, "id">): BackgroundTask {
  return {
    sessionId: "main-sess",
    kind: "agent",
    startedAt: "2026-07-15T00:00:00.000Z",
    stopped: false,
    abort: () => {},
    subagentName: "Explore",
    description: "find auth",
    childSessionId: `child-${partial.id}`,
    ...partial,
  };
}

describe("listManageableAgentTasks / canManageSessionAgents", () => {
  it("keeps only live agent tasks", () => {
    const tasks = [
      agentTask({ id: "a1" }),
      agentTask({ id: "a2", stopped: true }),
      agentTask({ id: "w1", kind: "workflow" }),
      agentTask({ id: "a3", description: "scan routes" }),
    ];
    expect(listManageableAgentTasks(tasks).map((t) => t.id)).toEqual(["a1", "a3"]);
    expect(canManageSessionAgents(tasks)).toBe(true);
    expect(canManageSessionAgents([agentTask({ id: "x", stopped: true })])).toBe(false);
  });

  it("includes foreground blocking agents in the manage list", () => {
    const tasks = [agentTask({ id: "fg", blocking: true, subagentName: "Explore" })];
    expect(listManageableAgentTasks(tasks)).toHaveLength(1);
    expect(canManageSessionAgents(tasks)).toBe(true);
  });
});

describe("countBackgroundWaitingAgents", () => {
  it("counts only non-blocking (true background) agents", () => {
    const tasks = [
      agentTask({ id: "fg", blocking: true }),
      agentTask({ id: "bg1" }),
      agentTask({ id: "bg2", blocking: false }),
      agentTask({ id: "done", stopped: true }),
    ];
    expect(countBackgroundWaitingAgents(tasks)).toBe(2);
  });
});

describe("buildSessionAgentRows", () => {
  it("returns empty when no live agents", () => {
    expect(buildSessionAgentRows([])).toEqual([]);
    expect(buildSessionAgentRows([agentTask({ id: "a", stopped: true })])).toEqual([]);
  });

  it("prepends main then live subagents", () => {
    const rows = buildSessionAgentRows([
      agentTask({ id: "t1", subagentName: "Explore", description: "find auth" }),
      agentTask({ id: "t2", subagentName: "Bash", description: "npm test" }),
    ]);
    expect(rows).toEqual([
      { kind: "main", label: "main" },
      {
        kind: "subagent",
        taskId: "t1",
        name: "Explore",
        description: "find auth",
        startedAt: "2026-07-15T00:00:00.000Z",
        childSessionId: "child-t1",
      },
      {
        kind: "subagent",
        taskId: "t2",
        name: "Bash",
        description: "npm test",
        startedAt: "2026-07-15T00:00:00.000Z",
        childSessionId: "child-t2",
      },
    ]);
  });

  it("freezes footer elapsed time when endedAt is set", () => {
    const startedAt = "2026-07-15T00:00:00.000Z";
    const endedAt = "2026-07-15T00:01:13.000Z";
    const row: SessionSubagentRow = {
      kind: "subagent",
      taskId: "t1",
      name: "Explore",
      description: "scan",
      startedAt,
      endedAt,
      childSessionId: "child-1",
    };
    expect(subagentElapsedMs(row, Date.parse("2026-07-15T01:00:00.000Z"))).toBe(73_000);

    const lines = renderSessionAgentListLines({
      rows: [{ kind: "main", label: "main" }, row],
      selected: 1,
      currentIndex: 1,
      cols: 100,
      now: Date.parse("2026-07-15T01:00:00.000Z"),
    });
    const plain = stripAnsi(lines[1]!);
    expect(plain).toContain("1m 13s");
    expect(plain).not.toContain("1h");
  });

  it("keeps pinned finished Explore in footer rows for detail switcher", () => {
    const pin = resolveAgentDetailPinRow(
      [agentTask({ id: "t1", subagentName: "Explore", description: "scan llm" })],
      "child-t1",
    );
    // Task store empty after completeBackgroundTask deletes the entry.
    const rows = buildSessionAgentRowsWithDetailPin([], pin);
    expect(rows).toEqual([
      { kind: "main", label: "main" },
      pin,
    ]);
    expect(currentSessionAgentIndex(rows, "child-t1")).toBe(1);
  });

  it("does not duplicate pin when the agent is still live", () => {
    const tasks = [agentTask({ id: "t1", subagentName: "Explore", description: "scan llm" })];
    const pin = resolveAgentDetailPinRow(tasks, "child-t1");
    const rows = buildSessionAgentRowsWithDetailPin(tasks, pin);
    expect(rows.filter((r) => r.kind === "subagent")).toHaveLength(1);
  });

  it("falls back when name/description missing", () => {
    const rows = buildSessionAgentRows([
      agentTask({
        id: "t9",
        subagentName: undefined,
        description: undefined,
        childSessionId: undefined,
      }),
    ]);
    expect(rows[1]).toMatchObject({
      kind: "subagent",
      taskId: "t9",
      name: "agent",
      description: "t9",
    });
  });
});

describe("focus / selection helpers", () => {
  it("moves focus from input to list when agents are manageable", () => {
    expect(focusFromInputDown(true)).toBe("list");
    expect(focusFromInputDown(false)).toBe("input");
  });

  it("focuses agents when ↓ leaves history onto an empty draft", () => {
    expect(
      shouldFocusAgentListAfterLeavingHistory({
        leftHistory: true,
        canManageAgents: true,
        draft: "",
        cursor: 0,
      }),
    ).toBe(true);
  });

  it("stays in input when ↓ leaves history onto a non-empty draft at start", () => {
    expect(
      shouldFocusAgentListAfterLeavingHistory({
        leftHistory: true,
        canManageAgents: true,
        draft: "继续写报告",
        cursor: 0,
      }),
    ).toBe(false);
  });

  it("does not focus agents while still browsing history", () => {
    expect(
      shouldFocusAgentListAfterLeavingHistory({
        leftHistory: false,
        canManageAgents: true,
        draft: "",
        cursor: 0,
      }),
    ).toBe(false);
  });

  it("returns to input when ↑ on first list row", () => {
    expect(focusAfterListUp(0, 2)).toEqual({ focus: "input", selected: 0 });
    expect(focusAfterListUp(1, 2)).toEqual({ focus: "list", selected: 0 });
    expect(focusAfterListUp(2, 3)).toEqual({ focus: "list", selected: 1 });
  });

  it("clamps selection movement within rows", () => {
    expect(moveAgentSelection(0, 1, 3)).toBe(1);
    expect(moveAgentSelection(2, 1, 3)).toBe(2);
    expect(moveAgentSelection(1, -1, 3)).toBe(0);
  });

  it("opens Agents on ← only when the compose box is empty", () => {
    expect(shouldOpenAgentsOnCursorLeft(0, 0)).toBe(true);
    expect(shouldOpenAgentsOnCursorLeft(5, 0)).toBe(false);
    expect(shouldOpenAgentsOnCursorLeft(5, 3)).toBe(false);
    expect(shouldOpenAgentsOnCursorLeft(0, 1)).toBe(false);
  });

  it("prioritizes pop-detail over Agents when detail is open", () => {
    expect(shouldPopAgentDetailOnLeft(true)).toBe(true);
    expect(shouldPopAgentDetailOnLeft(false)).toBe(false);
  });
});

describe("renderSessionAgentListLines", () => {
  it("input-focused: ● main / ○ Explore with no caret", () => {
    const rows = buildSessionAgentRows([
      agentTask({ id: "t1", subagentName: "Explore", description: "find auth" }),
    ]);
    const plain = renderSessionAgentListLines({
      rows,
      selected: 0,
      currentIndex: 0,
      listFocused: false,
      now: Date.parse("2026-07-15T00:00:12.000Z"),
      cols: 60,
    }).map(stripAnsi);
    expect(plain[0]).toMatch(/^ {2} {2}● main$/);
    expect(plain[1]).toMatch(/^ {2} {2}○ Explore find auth/);
    expect(plain[1]).toContain("12s");
  });

  it("list-focused: bold white > and white selected label", () => {
    const rows = buildSessionAgentRows([
      agentTask({ id: "t1", subagentName: "Explore", description: "find auth" }),
    ]);
    const onMain = renderSessionAgentListLines({
      rows,
      selected: 0,
      currentIndex: 0,
      listFocused: true,
      cols: 60,
    });
    const onMainPlain = onMain.map(stripAnsi);
    expect(onMainPlain[0]).toMatch(/^ {2}> ● main$/);
    expect(onMainPlain[1]).toMatch(/^ {2} {2}○ Explore find auth/);
    expect(onMain[0]).toContain("\x1b[1m"); // bold caret
    expect(onMain[0]).toContain("\x1b[38;5;255m"); // white

    // Keyboard on main while Explore is the current view — selected label still white.
    const selectMainWhileExplore = renderSessionAgentListLines({
      rows,
      selected: 0,
      currentIndex: 1,
      listFocused: true,
      cols: 60,
    });
    expect(stripAnsi(selectMainWhileExplore[0]!)).toMatch(/^ {2}> ○ main$/);
    expect(selectMainWhileExplore[0]).toContain("\x1b[1m");
    expect(selectMainWhileExplore[0]).toContain("\x1b[38;5;255m");

    const onExplore = renderSessionAgentListLines({
      rows,
      selected: 1,
      currentIndex: 0,
      listFocused: true,
      now: Date.parse("2026-07-15T00:00:12.000Z"),
      cols: 60,
    });
    const onExplorePlain = onExplore.map(stripAnsi);
    expect(onExplorePlain[0]).toMatch(/^ {2} {2}● main$/);
    expect(onExplorePlain[1]).toMatch(/^ {2}> ○ Explore find auth/);
    expect(onExplore[1]).toContain("\x1b[1m");
    expect(onExplore[1]).toContain("\x1b[38;5;255m");
  });

  it("uses green ● when Explore is the current view", () => {
    const rows = buildSessionAgentRows([
      agentTask({ id: "t1", subagentName: "Explore", description: "搜索LLM相关调用" }),
    ]);
    const rendered = renderSessionAgentListLines({
      rows,
      selected: 1,
      currentIndex: 1,
      listFocused: false,
      cols: 60,
    });
    const plain = rendered.map(stripAnsi);
    expect(plain[0]).toMatch(/^ {2} {2}○ main$/);
    expect(plain[1]).toMatch(/^ {2} {2}● Explore/);
    // green ANSI (38;5;114) on the Explore current marker
    expect(rendered[1]).toContain("\x1b[38;5;114m");
    expect(rendered[1]).toContain("●");
    expect(rendered[0]).not.toContain("\x1b[38;5;114m");
  });
});

describe("currentSessionAgentIndex", () => {
  it("returns 0 for main and the matching subagent when detail is open", () => {
    const rows = buildSessionAgentRows([
      agentTask({ id: "t1", childSessionId: "child-t1" }),
      agentTask({ id: "t2", childSessionId: "child-t2" }),
    ]);
    expect(currentSessionAgentIndex(rows, null)).toBe(0);
    expect(currentSessionAgentIndex(rows, "child-t2")).toBe(2);
    expect(currentSessionAgentIndex(rows, "missing")).toBe(0);
  });
});

describe("agentListShortcutsHint", () => {
  it("matches Claude Enter to view / x to stop copy", () => {
    expect(stripAnsi(agentListShortcutsHint())).toBe("Enter to view · x to stop");
  });
});

describe("shouldShowChatInputCaret", () => {
  it("shows caret while awaiting a line or during a live turn", () => {
    expect(
      shouldShowChatInputCaret({
        listFocused: false,
        overlayActive: false,
        mouseSelecting: false,
        hasSelection: false,
        awaitingLine: true,
        turnInProgress: false,
      }),
    ).toBe(true);
    expect(
      shouldShowChatInputCaret({
        listFocused: false,
        overlayActive: false,
        mouseSelecting: false,
        hasSelection: false,
        awaitingLine: false,
        turnInProgress: true,
      }),
    ).toBe(true);
  });

  it("hides caret when the agent list is focused", () => {
    expect(
      shouldShowChatInputCaret({
        listFocused: true,
        overlayActive: false,
        mouseSelecting: false,
        hasSelection: false,
        awaitingLine: true,
        turnInProgress: true,
      }),
    ).toBe(false);
  });
});
