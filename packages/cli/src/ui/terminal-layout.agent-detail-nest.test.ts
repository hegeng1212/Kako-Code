import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ChatLayout } from "./terminal-layout.js";
import { renderInitialInputFooter } from "./welcome.js";
import type { ChatTurn, ToolCallTimelineEntry } from "./chat-blocks.js";

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
  activeTurn: ChatTurn | null;
  turns: ChatTurn[];
  agentDetailSnapshot: {
    turns: ChatTurn[];
    activeTurn: ChatTurn | null;
    plainLines: string[];
    tipText: string | null;
    scrollOffset: number;
    followBottom: boolean;
  } | null;
  agentDetailChildSessionId: string | null;
  closeAgentDetail: () => void;
};

function agentEntry(turn: ChatTurn): ToolCallTimelineEntry {
  const entry = turn.timeline.find(
    (e): e is ToolCallTimelineEntry => e.type === "tool" && e.name === "Agent",
  );
  if (!entry) throw new Error("expected Agent tool on turn");
  return entry;
}

describe("Explore detail keeps main Agent nest in sync", () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("nests parent-session tools under stashed main Agent while detail is open", () => {
    const layout = testLayout();
    const priv = layout as unknown as LayoutPriv;
    priv.sessionId = "sess-main";

    layout.beginTurn("explore the repo");
    layout.beginToolCall(
      "Agent",
      "scan llm",
      { description: "scan llm", subagent_type: "Explore", prompt: "go" },
      "sess-main",
    );
    layout.beginToolCall("Glob", '{"pattern":"**/*"}', { pattern: "**/*" }, "sess-main");
    layout.finishToolCall("Glob", "success", undefined, "a.ts", "sess-main");

    const mainTurn = priv.activeTurn;
    expect(mainTurn).not.toBeNull();
    expect(agentEntry(mainTurn!).childTools?.map((c) => c.name)).toEqual(["Glob"]);

    // Simulate opening Explore detail: visible body becomes the child transcript.
    const childTurn: ChatTurn = {
      id: "child-turn",
      userText: "scan llm",
      answerText: "",
      thinkingStartedAt: Date.now(),
      thinkingEndedAt: null,
      finishedAt: null,
      doneVerb: null,
      generatingVerb: "Exploring",
      outputTokens: 0,
      phase: "answering",
      timeline: [],
      expandedThoughts: new Set(),
      expandedToolGroups: new Set(),
      expandedChoices: new Set(),
      pulseFrame: 0,
    };
    priv.agentDetailSnapshot = {
      turns: [],
      activeTurn: mainTurn,
      plainLines: [],
      tipText: null,
      scrollOffset: 0,
      followBottom: true,
    };
    priv.agentDetailChildSessionId = "child-1";
    priv.turns = [];
    priv.activeTurn = childTurn;

    // Child tools still report against the parent sessionId (runtime contract).
    layout.beginToolCall("Grep", "llm", { pattern: "llm" }, "sess-main");
    layout.finishToolCall("Grep", "success", undefined, "match", "sess-main");
    layout.beginToolCall("Read", "main.go", { file_path: "main.go" }, "sess-main");

    expect(agentEntry(mainTurn!).childTools?.map((c) => c.name)).toEqual([
      "Glob",
      "Grep",
      "Read",
    ]);
    // Must not glue parent tools onto the on-screen child transcript turn.
    expect(childTurn.timeline).toEqual([]);

    priv.closeAgentDetail();
    expect(priv.agentDetailSnapshot).toBeNull();
    expect(priv.activeTurn).toBe(mainTurn);
    expect(agentEntry(priv.activeTurn!).childTools?.map((c) => c.name)).toEqual([
      "Glob",
      "Grep",
      "Read",
    ]);
  });

  it("routes a follow-up main turn to the visible chat after Explore detail was open", () => {
    const layout = testLayout();
    const priv = layout as unknown as LayoutPriv;
    priv.sessionId = "sess-main";

    layout.beginTurn("analyze architecture");
    layout.beginToolCall(
      "Agent",
      "scan llm",
      { description: "scan llm", subagent_type: "Explore", prompt: "go" },
      "sess-main",
    );
    layout.finishToolCall("Agent", "success", undefined, "done", "sess-main");
    layout.appendAnswer("Architecture summary.");
    layout.finishTurn();

    const completedTurn = priv.turns[0]!;
    expect(completedTurn.answerText).toBe("Architecture summary.");

    // User watched Explore detail; parent turn finished while stash still exists.
    priv.agentDetailSnapshot = {
      turns: priv.turns,
      activeTurn: null,
      plainLines: [],
      tipText: null,
      scrollOffset: 0,
      followBottom: true,
    };
    priv.agentDetailChildSessionId = "child-1";
    priv.turns = [];
    priv.activeTurn = null;

    layout.beginTurn("我想写一份调研报告");
    layout.appendAnswer("好的，我来帮你起草调研报告。");
    layout.finishTurn();

    expect(priv.agentDetailSnapshot).toBeNull();
    expect(priv.turns).toHaveLength(2);
    expect(priv.turns[1]!.userText).toBe("我想写一份调研报告");
    expect(priv.turns[1]!.answerText).toBe("好的，我来帮你起草调研报告。");
  });

  it("streams child-session tools into Explore detail like a normal agent", () => {
    const layout = testLayout();
    const priv = layout as unknown as LayoutPriv & {
      parkedSessions: Map<string, { turns: ChatTurn[]; activeTurn: ChatTurn | null }>;
    };
    priv.sessionId = "sess-main";

    layout.beginTurn("explore the repo");
    layout.beginToolCall(
      "Agent",
      "scan llm",
      { description: "scan llm", subagent_type: "Explore", prompt: "go" },
      "sess-main",
    );
    const parentTurn = priv.activeTurn;

    // Child gets its own live turn (onSubAgentSessionStart → beginTurnForSession).
    layout.beginTurnForSession("child-1", "scan llm architecture");
    priv.agentDetailSnapshot = {
      turns: [],
      activeTurn: parentTurn,
      plainLines: [],
      tipText: null,
      scrollOffset: 0,
      followBottom: true,
    };
    priv.agentDetailChildSessionId = "child-1";
    const park = priv.parkedSessions.get("child-1")!;
    priv.turns = park.turns;
    priv.activeTurn = park.activeTurn;

    layout.beginToolCall("Glob", "**/*", { pattern: "**/*" }, "child-1");
    layout.finishToolCall("Glob", "success", undefined, "found 54 files", "child-1");
    layout.beginToolCall("Read", "go.mod", { file_path: "go.mod" }, "child-1");
    layout.appendAnswer("Found LLM entrypoints.", "child-1");

    expect(priv.activeTurn?.id.startsWith("turn-")).toBe(true);
    expect(priv.activeTurn?.timeline.some((e) => e.type === "tool" && e.name === "Glob")).toBe(
      true,
    );
    expect(priv.activeTurn?.timeline.some((e) => e.type === "tool" && e.name === "Read")).toBe(
      true,
    );
    expect(priv.activeTurn?.answerText).toBe("Found LLM entrypoints.");
    // Parent nest still only has the Agent tool (child tools mirrored separately in runtime).
    expect(agentEntry(parentTurn!).childTools ?? []).toEqual([]);
  });

  it("keeps child activeTurn visible while parent session streams in the background", () => {
    const layout = testLayout();
    const priv = layout as unknown as LayoutPriv;
    priv.sessionId = "sess-main";

    layout.beginTurn("explore the repo");
    layout.beginToolCall(
      "Agent",
      "scan llm",
      { description: "scan llm", subagent_type: "Explore", prompt: "go" },
      "sess-main",
    );
    const parentTurn = priv.activeTurn;

    const childTurn: ChatTurn = {
      id: "child-turn",
      userText: "scan llm",
      answerText: "child answer",
      thinkingStartedAt: Date.now(),
      thinkingEndedAt: null,
      finishedAt: null,
      doneVerb: null,
      generatingVerb: "Exploring",
      outputTokens: 0,
      phase: "answering",
      timeline: [],
      expandedThoughts: new Set(),
      expandedToolGroups: new Set(),
      expandedChoices: new Set(),
      pulseFrame: 0,
    };
    priv.agentDetailSnapshot = {
      turns: priv.turns,
      activeTurn: parentTurn,
      plainLines: [],
      tipText: null,
      scrollOffset: 0,
      followBottom: true,
    };
    priv.agentDetailChildSessionId = "child-1";
    priv.turns = [];
    priv.activeTurn = childTurn;

    layout.appendAnswer("parent should not replace child", "sess-main");
    expect(priv.activeTurn).toBe(childTurn);
    expect(priv.activeTurn?.answerText).toBe("child answer");

    layout.beginToolCall("Grep", "llm", { pattern: "llm" }, "sess-main");
    expect(priv.activeTurn).toBe(childTurn);
    expect(agentEntry(parentTurn!).childTools?.map((c) => c.name)).toEqual(["Grep"]);
  });
});
