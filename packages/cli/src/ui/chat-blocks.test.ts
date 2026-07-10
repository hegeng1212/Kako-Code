import { describe, expect, it } from "vitest";
import {
  DONE_VERBS,
  GENERATING_VERBS,
  renderThoughtSummaryForEntry,
  renderSmooshingLine,
  resolveLiveActivityPhase,
  renderDoneStatus,
  renderTurnToLines,
  renderUserMessage,
  type ChatTurn,
} from "./chat-blocks.js";
import { stripAnsi, ansi, displayWidth } from "./ansi.js";

function baseTurn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: "t1",
    userText: "你好",
    answerText: "",
    thinkingExpanded: false,
    thinkingStartedAt: Date.now() - 5000,
    thinkingEndedAt: null,
    finishedAt: null,
    doneVerb: null,
    generatingVerb: "Working",
    outputTokens: 0,
    phase: "thinking",
    timeline: [],
    expandedToolGroups: new Set(),
    expandedChoices: new Set(),
    pulseFrame: 0,
    ...overrides,
  };
}

describe("chat-blocks", () => {
  it("renders user message with full-width dark background", () => {
    const cols = 80;
    const lines = renderUserMessage("你好", cols);
    expect(lines[0]).toBe("");
    expect(lines[1]).toContain(ansi.userMessageBg);
    expect(lines[1]!.endsWith(ansi.reset)).toBe(true);
    expect(displayWidth(lines[1]!.slice(0, lines[1]!.lastIndexOf(ansi.reset)))).toBe(cols);
    expect(lines[1]!.startsWith("  ")).toBe(false);
    expect(stripAnsi(lines[1]!)).toContain("> 你好");
    expect(lines[2]).toBe("");
  });

  it("renders multiline user messages with continuation indent", () => {
    const cols = 100;
    const text = "[1] first line\n[2] second line";
    const lines = renderUserMessage(text, cols);
    expect(stripAnsi(lines[1]!)).toContain("> [1] first line");
    expect(stripAnsi(lines[2]!)).toContain("  [2] second line");
    expect(lines[1]).toContain(ansi.userMessageBg);
    expect(lines[2]).toContain(ansi.userMessageBg);
  });

  it("keeps user message background through nested foreground resets", () => {
    const cols = 120;
    const lines = renderUserMessage("写到一个 md 文件里面", cols);
    const line = lines[1]!;
    const resetCount = line.split(ansi.reset).length - 1;
    expect(resetCount).toBeGreaterThan(1);
    expect(displayWidth(line.slice(0, line.lastIndexOf(ansi.reset)))).toBe(cols);
  });

  it("colors slash commands in user messages like the input box", () => {
    const lines = renderUserMessage("/deep-research quarterly report", 100);
    expect(lines[1]).toContain(ansi.planBorder);
    expect(lines[1]).toContain(ansi.bold);
    expect(stripAnsi(lines[1]!)).toContain("> /deep-research quarterly report");
    const argsOnly = renderUserMessage("/deep-research", 100);
    expect(argsOnly[1]).toContain(ansi.planBorder);
    expect(stripAnsi(argsOnly[1]!).trimEnd()).toBe(`> /deep-research`);
  });

  it("renders smooshing line with hms duration", () => {
    const turn = baseTurn({
      outputTokens: 169,
      phase: "answering",
      generatingVerb: "Cogitating",
      thinkingStartedAt: Date.now() - 437_000,
    });
    const line = stripAnsi(renderSmooshingLine(turn));
    expect(line).toContain("* Cogitating…");
    expect(line).toContain("7m 17s");
    expect(line).toContain("tokens");
  });

  it("shows waiting after tools complete while the model thinks", () => {
    const turn = baseTurn({
      phase: "thinking",
      timeline: [
        {
          type: "tool",
          id: "t1",
          name: "Read",
          detail: "/path",
          status: "success",
          dotFrame: 0,
        },
      ],
    });
    expect(resolveLiveActivityPhase(turn)).toBe("waiting");
    expect(stripAnsi(renderSmooshingLine(turn))).toContain("waiting");
  });

  it("shows tools while a tool call is in progress", () => {
    const turn = baseTurn({
      timeline: [
        {
          type: "tool",
          id: "t1",
          name: "Bash",
          detail: "ls",
          status: "waiting",
          dotFrame: 0,
        },
      ],
    });
    expect(resolveLiveActivityPhase(turn)).toBe("tools");
  });

  it("freezes thought duration after thinking ends", () => {
    const entry = {
      type: "thinking" as const,
      text: "分析用户问题",
      startedAt: 1_000,
      lastChunkAt: 4_000,
      endedAt: 4_000,
    };
    const frozen = renderThoughtSummaryForEntry(entry, 999_999, false);
    expect(stripAnsi(frozen)).toContain("Thought for 3s");
    expect(renderThoughtSummaryForEntry(entry, 888_888, false)).toBe(frozen);
  });

  it("preserves streamed thought duration after reasoning stops", () => {
    const startedAt = Date.now() - 3_500;
    const lastChunkAt = Date.now() - 200;
    const entry = {
      type: "thinking" as const,
      text: "streaming",
      startedAt,
      lastChunkAt,
      endedAt: null,
    };
    const live = stripAnsi(renderThoughtSummaryForEntry(entry, Date.now(), true));
    const frozen = stripAnsi(renderThoughtSummaryForEntry(entry, Date.now() + 60_000, false));
    expect(live).toMatch(/Thought for [34]s/);
    expect(frozen).toMatch(/Thought for 3s/);
  });

  it("never shows Thought for 0s", () => {
    const entry = {
      type: "thinking" as const,
      text: "brief",
      startedAt: Date.now() - 200,
      lastChunkAt: Date.now() - 50,
      endedAt: Date.now() - 50,
    };
    expect(stripAnsi(renderThoughtSummaryForEntry(entry, Date.now(), false))).toContain(
      "Thought for 1s",
    );
    expect(
      stripAnsi(renderThoughtSummaryForEntry(entry, Date.now(), false)),
    ).not.toContain("Thought for 0s");
  });

  it("shows at most one thought summary per turn (including after tools)", () => {
    const turn = baseTurn({
      userText: "我有几个宝宝",
      phase: "done",
      finishedAt: Date.now(),
      doneVerb: "Deliberated",
      timeline: [
        {
          type: "thinking",
          text: "查一下宝宝数量",
          startedAt: Date.now() - 4000,
          lastChunkAt: Date.now() - 3000,
          endedAt: Date.now() - 3000,
        },
        {
          type: "tool",
          id: "tool-1",
          name: "mcp/babytree/bbt_pregnancy.find_baby",
          detail: "{}",
          status: "success",
          dotFrame: 0,
        },
        { type: "answer", text: "你有 2 个宝宝" },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.filter((l) => l.includes("Thought for"))).toHaveLength(1);
  });

  it("aligns activity summary indent with legacy thought style", () => {
    const turn = baseTurn({
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "thinking",
          text: "planning",
          startedAt: Date.now() - 2_000,
          lastChunkAt: Date.now() - 500,
          endedAt: Date.now() - 500,
        },
        {
          type: "tool",
          id: "tool-1",
          name: "Grep",
          detail: "pattern",
          status: "success",
          dotFrame: 0,
        },
      ],
    });
    const lines = renderTurnToLines(turn, 100).map((l) => l.text);
    const activityLine = lines.find(
      (l) => stripAnsi(l).includes("Thought for") && stripAnsi(l).includes("searched content"),
    );
    expect(activityLine).toBeDefined();
    const indent = activityLine!.match(/^ */)?.[0].length ?? 0;
    expect(indent).toBe(4);
  });

  it("renders tool activity with block spacing matching other timeline entries", () => {
    const turn = baseTurn({
      userText: "我有几个宝宝",
      phase: "done",
      finishedAt: Date.now(),
      doneVerb: "Cooked",
      timeline: [
        { type: "answer", text: "让我帮你查一下。" },
        {
          type: "tool",
          id: "tool-1",
          name: "mcp/babytree/bbt_pregnancy.find_baby",
          detail: "{}",
          status: "success",
          dotFrame: 0,
        },
        { type: "answer", text: "你有 2 个宝宝" },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    const answerIdx = plain.findIndex((l) => l.includes("让我帮你查一下"));
    const toolIdx = plain.findIndex((l) => l.includes("called bbt_pregnancy.find_baby"));
    const followIdx = plain.findIndex((l) => l.includes("你有 2 个宝宝"));
    expect(plain[answerIdx + 1]).toBe("");
    expect(toolIdx).toBeGreaterThan(answerIdx);
    expect(plain[toolIdx + 1]).toBe("");
    expect(followIdx).toBeGreaterThan(toolIdx);
  });

  it("interleaves answer, tool, and follow-up answer", () => {
    const turn = baseTurn({
      userText: "查一下宝宝信息",
      phase: "done",
      finishedAt: Date.now(),
      doneVerb: "Cooked",
      timeline: [
        { type: "answer", text: "正在查询…" },
        {
          type: "tool",
          id: "tool-2",
          name: "mcp/babytree/bbt_pregnancy.find_baby",
          detail: "{}",
          status: "waiting",
          dotFrame: 1,
        },
        { type: "answer", text: "您有两个宝宝。" },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((line) => stripAnsi(line.text));
    const partialIdx = plain.findIndex((line) => line.includes("正在查询"));
    const toolIdx = plain.findIndex((line) => line.includes("Waiting"));
    const answerIdx = plain.findIndex((line) => line.includes("您有两个宝宝"));
    expect(partialIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBe(partialIdx + 2);
    expect(plain[toolIdx - 1]).toBe("");
    expect(answerIdx).toBe(toolIdx + 2);
  });

  it("picks completion verb from Claude-style list", () => {
    expect(DONE_VERBS).toContain("Cooked");
    expect(GENERATING_VERBS).toContain("Working");
  });

  it("collapses adjacent successful tool calls into one clickable group", () => {
    const turn = baseTurn({
      userText: "查项目",
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "tool",
          id: "tool-1",
          name: "Read",
          detail: "/path/a.md",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "tool",
          id: "tool-2",
          name: "Bash",
          detail: "ls -la",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "tool",
          id: "tool-3",
          name: "Read",
          detail: "/path/b.md",
          status: "success",
          dotFrame: 0,
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    const summary = plain.find((l) => l.includes("read 1 file") && l.includes("click to expand"));
    expect(summary).toBeDefined();
    expect(plain.filter((l) => l.includes("ls -la"))).toHaveLength(0);
  });

  it("expands collapsed tool group when toggled", () => {
    const turn = baseTurn({
      id: "t-collapse",
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "tool",
          id: "tool-1",
          name: "Read",
          detail: "/path/a.md",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "tool",
          id: "tool-2",
          name: "Bash",
          detail: "ls -la",
          status: "success",
          dotFrame: 0,
        },
      ],
    });
    turn.expandedToolGroups.add("t-collapse:tools:0");
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("read 1 file") && l.includes("click to collapse"))).toBe(
      true,
    );
    expect(plain.some((l) => l.includes("Bash(ls -la)"))).toBe(true);
    expect(plain.some((l) => l.includes("Read(/path/a.md)"))).toBe(true);
    expect(plain.some((l) => /⏺\s*Bash/.test(l))).toBe(false);
  });

  it("summarizes execution bash as ran 1 shell command with expanded output", () => {
    const turn = baseTurn({
      id: "t-bash-exec",
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "tool",
          id: "tool-1",
          name: "Bash",
          detail: "python3 add.py 15.6 28.3",
          status: "success",
          dotFrame: 0,
          toolInput: { command: "python3 add.py 15.6 28.3" },
          output: "计算结果: 15.6 + 28.3 = 43.9",
        },
      ],
    });
    turn.expandedToolGroups.add("t-bash-exec:tools:0");
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("ran 1 shell command"))).toBe(true);
    expect(plain.some((l) => l.includes("Bash(python3 add.py 15.6 28.3)"))).toBe(true);
    expect(plain.some((l) => l.includes("计算结果: 15.6 + 28.3 = 43.9"))).toBe(true);
  });

  it("keeps waiting tools visible outside collapsed groups", () => {
    const turn = baseTurn({
      phase: "thinking",
      timeline: [
        {
          type: "tool",
          id: "tool-1",
          name: "Read",
          detail: "a.md",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "tool",
          id: "tool-2",
          name: "Bash",
          detail: "ls",
          status: "waiting",
          dotFrame: 1,
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("read 1 file"))).toBe(true);
    expect(plain.filter((l) => l.includes("Waiting"))).toHaveLength(1);
  });

  it("merges thinking duration into activity summary before tools", () => {
    const turn = baseTurn({
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "thinking",
          text: "hmm",
          startedAt: Date.now() - 12_000,
          lastChunkAt: Date.now() - 6_000,
          endedAt: Date.now() - 6_000,
        },
        {
          type: "tool",
          id: "tool-1",
          name: "Bash",
          detail: "ls -la /tmp",
          status: "success",
          dotFrame: 0,
          output: "drwxr-xr-x  3 user  staff  96 .\n",
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("Thought for") && l.includes("listed 1 directory"))).toBe(
      true,
    );
    expect(plain.filter((l) => l.includes("Thought for") && l.includes("▸"))).toHaveLength(1);
  });

  it("renders Updated plan, preview hint, and bordered plan box", () => {
    const turn = baseTurn({
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "tool",
          id: "tool-plan",
          name: "Write",
          detail: "/Users/me/.kako/plans/sess.md",
          status: "success",
          dotFrame: 0,
          output: "# Plan\n\nStep 1",
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("Updated plan"))).toBe(true);
    expect(plain.some((l) => l.includes("/plan to preview"))).toBe(true);
    expect(plain.some((l) => l.includes("┌"))).toBe(true);
    expect(plain.some((l) => l.includes("│") && l.includes("Plan"))).toBe(true);
    expect(plain.some((l) => /└─+┘/.test(l))).toBe(true);
  });

  it("renders grouped choice answers for multi-question wizard", () => {
    const turn = baseTurn({
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "choice-group",
          id: "choice-group-1",
          items: [
            {
              header: "Topic1",
              question: "Which direction?",
              answer: "Option B",
              multiSelect: false,
              options: [
                { label: "Option A", description: "First path" },
                { label: "Option B", description: "Second path" },
              ],
            },
            {
              header: "Scope",
              question: "Which scope?",
              answer: "Scope X",
              multiSelect: false,
              options: [
                { label: "Scope X", description: "Narrow" },
                { label: "Scope Y", description: "Broad" },
              ],
            },
          ],
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("User answered Kako's questions"))).toBe(true);
    expect(plain.filter((l) => l.includes("→ Option B"))).toHaveLength(1);
    expect(plain.filter((l) => l.includes("→ Scope X"))).toHaveLength(1);
    expect(plain.filter((l) => l.includes("click to expand"))).toHaveLength(0);
  });

  it("renders collapsed single choice answers with spacing and expandable options", () => {
    const turn = baseTurn({
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "choice",
          id: "choice-1",
          header: "Direction",
          question: "Which direction?",
          answer: "Option B",
          multiSelect: false,
          options: [
            { label: "Option A", description: "First path" },
            { label: "Option B", description: "Second path" },
          ],
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.filter((l) => l.includes("→ Option B"))).toHaveLength(1);
    expect(plain.filter((l) => l.includes("Option A"))).toHaveLength(0);
    expect(plain.filter((l) => l.includes("click to expand"))).toHaveLength(1);
  });

  it("expands choice options when toggled", () => {
    const turn = baseTurn({
      id: "t-choice",
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "choice",
          id: "choice-1",
          header: "Direction",
          question: "Which direction?",
          answer: "Option B",
          multiSelect: false,
          options: [
            { label: "Option A", description: "First path" },
            { label: "Option B", description: "Second path" },
          ],
        },
      ],
    });
    turn.expandedChoices.add("choice-1");
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("Option A"))).toBe(true);
    expect(plain.some((l) => l.includes("click to collapse"))).toBe(true);
  });
});
