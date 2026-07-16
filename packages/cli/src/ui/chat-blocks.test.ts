import { describe, expect, it } from "vitest";
import {
  DONE_VERBS,
  GENERATING_VERBS,
  collectLiveWaitingPinLines,
  renderThoughtSummaryForEntry,
  renderSmooshingLine,
  resolveLiveActivityPhase,
  renderDoneStatus,
  renderTurnToLines,
  renderUserMessage,
  toggleThoughtExpanded,
  turnElapsedSeconds,
  type ChatTurn,
} from "./chat-blocks.js";
import { stripAnsi, ansi, displayWidth } from "./ansi.js";

function baseTurn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: "t1",
    userText: "你好",
    answerText: "",
    thinkingStartedAt: Date.now() - 5000,
    thinkingEndedAt: null,
    finishedAt: null,
    doneVerb: null,
    generatingVerb: "Working",
    outputTokens: 0,
    phase: "thinking",
    timeline: [],
    expandedThoughts: new Set(),
    expandedToolGroups: new Set(),
    expandedChoices: new Set(),
    pulseFrame: 0,
    ...overrides,
  };
}

describe("chat-blocks", () => {
  it("rounds short turn elapsed time up to at least 1s", () => {
    const now = 1_000_000;
    expect(
      turnElapsedSeconds(
        baseTurn({ thinkingStartedAt: now - 400, finishedAt: now }),
        now,
      ),
    ).toBe(1);
    expect(
      turnElapsedSeconds(
        baseTurn({ thinkingStartedAt: now - 12_400, finishedAt: now }),
        now,
      ),
    ).toBe(12);
  });

  it("renders user message with full-width dark background and white text", () => {
    const cols = 80;
    const lines = renderUserMessage("你好", cols);
    expect(lines[0]).toBe("");
    expect(lines[1]).toContain(ansi.userMessageBg);
    expect(lines[1]).toContain(ansi.text);
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
    // Live status * morphs (point → orb → star); pulseFrame 0 starts at ".".
    expect(line).toMatch(/[.oO*] Cogitating…/);
    expect(line).toContain("7m 17s");
    expect(line).toContain("tokens");
  });

  it("breathes red on verb and keeps meta white on smooshing line", () => {
    const turn = baseTurn({
      outputTokens: 42,
      phase: "answering",
      generatingVerb: "Refining",
      pulseFrame: 3,
      thinkingStartedAt: Date.now() - 56_000,
    });
    const colored = renderSmooshingLine(turn);
    expect(colored).toContain(`${ansi.text}(`);
    const metaIdx = colored.indexOf(`${ansi.text}(`);
    expect(metaIdx).toBeGreaterThan(0);
    expect(colored.slice(0, metaIdx)).toContain(ansi.red);
    expect(colored.slice(metaIdx)).not.toContain(ansi.red);
    expect(stripAnsi(colored)).toMatch(/[.oO*] Refining… \(\d+s · ↓ 42 tokens · writing\)/);
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
    expect(live).toMatch(/Thinking for [34]s\.\.\./);
    expect(frozen).toMatch(/Thought for 3s/);
  });

  it("renders live thinking as Thinking for + └ body", () => {
    const now = Date.now();
    const turn = baseTurn({
      phase: "thinking",
      timeline: [
        {
          type: "thinking",
          text: "用户要求改接口",
          startedAt: now - 10_000,
          lastChunkAt: now - 100,
          endedAt: null,
        },
      ],
      expandedThoughts: new Set([0]),
    });
    const plain = renderTurnToLines(turn, 100, now, { isActive: true }).map((l) =>
      stripAnsi(l.text),
    );
    expect(plain.some((l) => /Thinking for \d+s\.\.\./.test(l))).toBe(true);
    expect(plain.some((l) => l.includes("└") && l.includes("用户要求改接口"))).toBe(true);
    expect(plain.some((l) => l.includes("Thought for"))).toBe(false);
    expect(plain.some((l) => l.includes("∴"))).toBe(false);
  });

  it("collapses finished thinking to Thought for; expand shows ∴ without header", () => {
    const now = Date.now();
    const turn = baseTurn({
      phase: "done",
      finishedAt: now,
      thinkingEndedAt: now - 1000,
      timeline: [
        {
          type: "thinking",
          text: "分析完毕",
          startedAt: now - 5000,
          lastChunkAt: now - 1000,
          endedAt: now - 1000,
        },
        { type: "answer", text: "好的" },
      ],
      expandedThoughts: new Set(),
    });
    let plain = renderTurnToLines(turn, 100, now).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => /Thought for \d+s/.test(l))).toBe(true);
    expect(plain.some((l) => l.includes("∴"))).toBe(false);
    expect(plain.some((l) => l.includes("Thinking for"))).toBe(false);

    toggleThoughtExpanded(turn, 0);
    plain = renderTurnToLines(turn, 100, now).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("∴") && l.includes("分析完毕"))).toBe(true);
    expect(plain.some((l) => l.includes("Thought for"))).toBe(false);
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
    expect(plain.some((l) => l.includes("called bbt_pregnancy.find_baby"))).toBe(true);
    expect(plain.some((l) => l.includes("Thought for") && l.includes("called"))).toBe(false);
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
    const followIdx = plain.findIndex((l) => /你有\s*2\s*个宝宝/.test(l));
    expect(plain[answerIdx + 1]).toBe("");
    expect(toolIdx).toBeGreaterThan(answerIdx);
    expect(plain[toolIdx + 1]).toBe("");
    expect(followIdx).toBeGreaterThan(toolIdx);
  });

  it("renders dynamic workflow tool as Skill(name) in the timeline", () => {
    const turn = baseTurn({
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "tool",
          id: "tool-wf",
          name: "Workflow",
          detail: "deep-research",
          status: "success",
          dotFrame: 0,
          skillExpanded: true,
        },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("Skill(deep-research)"))).toBe(true);
    expect(plain.some((l) => l.includes("Successfully loaded skill"))).toBe(true);
    expect(plain.some((l) => l.includes("Workflow(dynamic workflow:"))).toBe(false);
  });

  it("renders workflow completion as timeline event, not user message", () => {
    const summary =
      'Dynamic workflow "Deep research harness" completed · 17m 48s';
    const turn = baseTurn({
      userText: "",
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "tool",
          id: "tool-wf",
          name: "Workflow",
          detail: "deep-research",
          status: "success",
          dotFrame: 0,
        },
        { type: "event", lines: [`└ ${summary}`] },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.startsWith(">"))).toBe(false);
    const toolIdx = plain.findIndex((l) => l.includes("deep-research"));
    const eventIdx = plain.findIndex((l) => l.includes(summary));
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(eventIdx).toBeGreaterThan(toolIdx);
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
    const toolIdx = plain.findIndex(
      (line) => line.includes("Waiting") || line.includes("find_baby"),
    );
    const answerIdx = plain.findIndex((line) => line.includes("您有两个宝宝"));
    expect(partialIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBe(partialIdx + 2);
    expect(plain[toolIdx - 1]).toBe("");
    expect(answerIdx).toBe(toolIdx + 2);
  });

  it("renders thinking and answer after tool activity in the same turn", () => {
    const now = Date.now();
    const turn = baseTurn({
      userText: "go test 测试通过了吗",
      phase: "answering",
      answerText: "测试已通过。",
      timeline: [
        {
          type: "thinking",
          text: "先跑测试。",
          startedAt: now - 3000,
          lastChunkAt: now - 2500,
          endedAt: now - 2500,
        },
        {
          type: "tool",
          id: "tool-bash",
          name: "Bash",
          detail: "cd /tmp/project && go test ./...",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "tool",
          id: "tool-read",
          name: "Read",
          detail: "/tmp/project/out.txt",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "thinking",
          text: "分析测试结果。",
          startedAt: now - 1000,
          lastChunkAt: now - 500,
          endedAt: now - 500,
        },
        { type: "answer", text: "测试已通过。" },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((line) => stripAnsi(line.text));
    expect(plain.some((line) => line.includes("ran 1 shell command") || line.includes("read 1 file"))).toBe(
      true,
    );
    expect(plain.some((line) => line.includes("Thought for"))).toBe(true);
    expect(plain.some((line) => line.includes("测试已通过"))).toBe(true);
  });

  it("alternates activity batches with primary model answers", () => {
    const now = Date.now();
    const turn = baseTurn({
      userText: "multi phase",
      phase: "done",
      finishedAt: now,
      timeline: [
        {
          type: "thinking",
          text: "phase one",
          startedAt: now - 5000,
          lastChunkAt: now - 4500,
          endedAt: now - 4500,
        },
        {
          type: "tool",
          id: "tool-read",
          name: "Read",
          detail: "/path/a.md",
          status: "success",
          dotFrame: 0,
        },
        { type: "answer", text: "First finding." },
        {
          type: "thinking",
          text: "phase two",
          startedAt: now - 3000,
          lastChunkAt: now - 2500,
          endedAt: now - 2500,
        },
        {
          type: "tool",
          id: "tool-bash",
          name: "Bash",
          detail: "python3 check.py",
          status: "success",
          dotFrame: 0,
          toolInput: { command: "python3 check.py" },
        },
        { type: "answer", text: "Final conclusion." },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((line) => stripAnsi(line.text));
    expect(plain.some((line) => line.includes("read 1 file"))).toBe(true);
    expect(plain.some((line) => line.includes("ran 1 shell command"))).toBe(true);
    expect(plain.some((line) => line.includes("First finding."))).toBe(true);
    expect(plain.some((line) => line.includes("Final conclusion."))).toBe(true);
    expect(plain.filter((line) => line.includes("Thought for") && line.includes("▸")).length).toBe(2);
  });

  it("shows duplicate assistant narration only once", () => {
    const turn = baseTurn({
      userText: "explore",
      phase: "done",
      finishedAt: Date.now(),
      answerText: "让我先查看项目的目录结构。",
      timeline: [
        {
          type: "tool",
          id: "tool-1",
          name: "Glob",
          detail: "**/*.go",
          status: "success",
          output: "a.go\nb.go",
          dotFrame: 0,
        },
        { type: "answer", text: "让我先查看项目的目录结构。" },
        {
          type: "tool",
          id: "tool-2",
          name: "Read",
          detail: "a.go",
          status: "success",
          dotFrame: 0,
        },
        // Mid-turn copy was primary (thinking gap); final copy is the same text.
        {
          type: "thinking",
          text: "plan",
          startedAt: Date.now() - 2000,
          lastChunkAt: Date.now() - 1500,
          endedAt: Date.now() - 1500,
        },
        { type: "answer", text: "让我先查看项目的目录结构。" },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((line) => stripAnsi(line.text));
    expect(plain.filter((line) => line.includes("让我先查看项目的目录结构。"))).toHaveLength(1);
  });

  it("splits long compact tool runs into multiple activity summaries", () => {
    const tools = Array.from({ length: 9 }, (_, i) => ({
      type: "tool" as const,
      id: `tool-${i}`,
      name: "Read",
      detail: `/path/file-${i}.md`,
      status: "success" as const,
      dotFrame: 0,
    }));
    const turn = baseTurn({
      userText: "scan",
      phase: "done",
      finishedAt: Date.now(),
      timeline: tools,
    });
    const summaries = renderTurnToLines(turn, 120)
      .map((line) => stripAnsi(line.text))
      .filter((line) => line.includes("click to expand"));
    expect(summaries.length).toBe(3);
    expect(summaries.every((line) => !/,.*,.*,.*,/.test(line.replace(/Thought for[^,]*,\s*/, "")))).toBe(
      true,
    );
  });

  it("picks completion verb from Claude-style list", () => {
    expect(DONE_VERBS).toContain("Cooked");
    expect(GENERATING_VERBS).toContain("Working");
  });

  it("splits activity batches at answers, events, and standalone tools", () => {
    const turn = baseTurn({
      userText: "explore",
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
        { type: "answer", text: "bridging narration" },
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
          id: "tool-agent",
          name: "Agent",
          detail: "explore API",
          status: "success",
          dotFrame: 0,
          toolInput: { description: "explore API", subagent_type: "explore" },
        },
        {
          type: "tool",
          id: "tool-3",
          name: "Read",
          detail: "/path/b.md",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "event",
          lines: ['└ Dynamic workflow "demo" completed · 1m'],
        },
        {
          type: "tool",
          id: "tool-4",
          name: "Read",
          detail: "/path/c.md",
          status: "success",
          dotFrame: 0,
        },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((line) => stripAnsi(line.text));
    const summaries = plain.filter(
      (line) => line.includes("click to expand") || line.includes("click to collapse"),
    );
    expect(summaries.length).toBe(4);
    expect(plain.some((line) => /Explore\(explore API\)/i.test(line))).toBe(true);
    expect(plain.some((line) => /Done \(\d+ tool uses? · /.test(line))).toBe(true);
    const agentIdx = plain.findIndex((line) => /Explore\(explore API\)/i.test(line));
    const doneIdx = plain.findIndex((line) => /Done \(\d+ tool uses? · /.test(line));
    expect(doneIdx).toBe(agentIdx + 1);
    expect(plain.some((line) => line.includes("bridging narration"))).toBe(false);
  });

  it("compacts init turns into Skill(init) plus separate activity batches", () => {
    const turn = baseTurn({
      userText: "init",
      phase: "done",
      finishedAt: Date.now(),
      thinkingStartedAt: Date.now() - 42_000,
      thinkingEndedAt: Date.now() - 10_000,
      answerText: "KAKO.md is ready with architecture and test commands.",
      timeline: [
        {
          type: "tool",
          id: "tool-skill",
          name: "Skill",
          detail: "init",
          status: "success",
          dotFrame: 0,
        },
        { type: "answer", text: "I'll analyze the codebase first." },
        {
          type: "tool",
          id: "tool-1",
          name: "Bash",
          detail: "ls -la",
          status: "success",
          dotFrame: 0,
          output: "README.md\n",
        },
        { type: "answer", text: "Now I'll read key files." },
        {
          type: "tool",
          id: "tool-2",
          name: "Read",
          detail: "/path/README.md",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "tool",
          id: "tool-3",
          name: "Read",
          detail: "/path/package.json",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "tool",
          id: "tool-4",
          name: "Write",
          detail: "KAKO.md",
          status: "success",
          dotFrame: 0,
          output: "# KAKO.md\n",
        },
        { type: "answer", text: "KAKO.md is ready with architecture and test commands." },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("Skill(init)"))).toBe(true);
    expect(plain.some((l) => l.includes("read 2 files"))).toBe(true);
    expect(plain.some((l) => l.includes("listed 1 directory"))).toBe(true);
    expect(
      plain.filter(
        (l) =>
          l.includes("click to expand") &&
          (l.includes("read") || l.includes("listed") || l.includes("ran")),
      ).length,
    ).toBe(2);
    expect(plain.some((l) => l.includes("Write(KAKO.md)"))).toBe(true);
    expect(plain.some((l) => l.includes("I'll analyze the codebase first"))).toBe(false);
    expect(plain.some((l) => l.includes("Now I'll read key files"))).toBe(false);
    expect(plain.some((l) => l.includes("KAKO.md is ready with architecture and test commands"))).toBe(
      true,
    );
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
    const summary = plain.find((l) => l.includes("read 2 files") && l.includes("click to expand"));
    expect(summary).toBeDefined();
    expect(plain.filter((l) => l.includes("ls -la"))).toHaveLength(0);
  });

  it("expands activity batch with thinking content in tree layout", () => {
    const now = Date.now();
    const turn = baseTurn({
      id: "t-thought-tree",
      phase: "done",
      finishedAt: now,
      timeline: [
        {
          type: "thinking",
          text: "查询疫苗接种记录。",
          startedAt: now - 5000,
          lastChunkAt: now - 4500,
          endedAt: now - 4500,
        },
        {
          type: "tool",
          id: "tool-read",
          name: "Read",
          detail: "/path/vaccine.json",
          status: "success",
          dotFrame: 0,
          output: '{"baby_age":"1岁1个月","list":[]}',
        },
      ],
    });
    turn.expandedToolGroups.add("t-thought-tree:activity:0");
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("Thought for") && l.includes("read 1 file"))).toBe(true);
    expect(plain.some((l) => l.includes("∴ 查询疫苗接种记录"))).toBe(true);
    expect(plain.some((l) => l.includes("Read(/path/vaccine.json)"))).toBe(true);
    expect(plain.some((l) => l.includes("baby_age"))).toBe(true);
    expect(plain.some((l) => l.includes("│ Thought for"))).toBe(true);
    expect(plain.some((l) => l.includes("└") && l.includes("Read(/path/vaccine.json)"))).toBe(true);
  });

  it("renders MCP tools standalone, not merged into thinking batches", () => {
    const now = Date.now();
    const turn = baseTurn({
      userText: "下次什么时候疫苗",
      phase: "done",
      finishedAt: now,
      timeline: [
        {
          type: "thinking",
          text: "先查宝宝。",
          startedAt: now - 2000,
          lastChunkAt: now - 1500,
          endedAt: now - 1500,
        },
        {
          type: "tool",
          id: "tool-baby",
          name: "mcp/babytree/bbt_pregnancy.find_baby",
          detail: "{}",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "thinking",
          text: "再查疫苗。",
          startedAt: now - 6000,
          lastChunkAt: now - 5000,
          endedAt: now - 5000,
        },
        {
          type: "tool",
          id: "tool-vaccine",
          name: "mcp/babytree/bbt_tool.get_vaccine_info",
          detail: '{"baby_id":"123"}',
          status: "success",
          dotFrame: 0,
        },
        { type: "answer", text: "下次疫苗在 2026-08-01。" },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(plain.filter((l) => l.includes("Thought for") && l.includes("called"))).toHaveLength(0);
    expect(plain.filter((l) => l.includes("Thought for"))).toHaveLength(2);
    expect(plain.some((l) => l.includes("called bbt_pregnancy.find_baby"))).toBe(true);
    expect(plain.some((l) => l.includes("called bbt_tool.get_vaccine_info"))).toBe(true);
    const firstThoughtIdx = plain.findIndex((l) => l.includes("Thought for"));
    const firstMcpIdx = plain.findIndex((l) => l.includes("called bbt_pregnancy.find_baby"));
    const secondMcpIdx = plain.findIndex((l) => l.includes("called bbt_tool.get_vaccine_info"));
    const secondThoughtIdx = plain.findLastIndex((l) => l.includes("Thought for"));
    expect(firstMcpIdx).toBeGreaterThan(firstThoughtIdx);
    expect(secondThoughtIdx).toBeGreaterThan(firstMcpIdx);
    expect(secondMcpIdx).toBeGreaterThan(secondThoughtIdx);
  });

  it("expands only the clicked thinking entry, not the last one", () => {
    const now = Date.now();
    const turn = baseTurn({
      phase: "done",
      finishedAt: now,
      timeline: [
        {
          type: "thinking",
          text: "first thought body",
          startedAt: now - 6000,
          lastChunkAt: now - 5000,
          endedAt: now - 5000,
        },
        { type: "answer", text: "bridge" },
        {
          type: "thinking",
          text: "last thought body",
          startedAt: now - 3000,
          lastChunkAt: now - 2000,
          endedAt: now - 2000,
        },
        { type: "answer", text: "done" },
      ],
    });
    toggleThoughtExpanded(turn, 0);
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("∴ first thought body"))).toBe(true);
    expect(plain.some((l) => l.includes("∴ last thought body"))).toBe(false);
    expect(plain.filter((l) => l.includes("Thought for"))).toHaveLength(1);
  });

  it("merges events after thinking but keeps thinking separate after events", () => {
    const now = Date.now();
    const turn = baseTurn({
      phase: "done",
      finishedAt: now,
      timeline: [
        {
          type: "thinking",
          text: "launch agent",
          startedAt: now - 3000,
          lastChunkAt: now - 2000,
          endedAt: now - 2000,
        },
        {
          type: "event",
          lines: ['└ Agent "scan API" finished'],
        },
        {
          type: "thinking",
          text: "summarize findings",
          startedAt: now - 1500,
          lastChunkAt: now - 500,
          endedAt: now - 500,
        },
        { type: "answer", text: "Done." },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    const eventIdx = plain.findIndex((l) => l.includes('Agent "scan API" finished'));
    const thoughtLines = plain
      .map((l, idx) => ({ l, idx }))
      .filter(({ l }) => l.includes("Thought for"));
    expect(eventIdx).toBeGreaterThanOrEqual(0);
    expect(thoughtLines).toHaveLength(2);
    expect(thoughtLines[0]!.idx).toBeLessThan(eventIdx);
    expect(thoughtLines[1]!.idx).toBeGreaterThan(eventIdx);
  });

  it("does not fold thinking into a preceding system event", () => {
    const now = Date.now();
    const turn = baseTurn({
      phase: "done",
      finishedAt: now,
      timeline: [
        {
          type: "event",
          lines: ['└ Dynamic workflow "research" completed · 5m 0s'],
        },
        {
          type: "thinking",
          text: "summarize report",
          startedAt: now - 2000,
          lastChunkAt: now - 1000,
          endedAt: now - 1000,
        },
        { type: "answer", text: "Here is the report." },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    const eventIdx = plain.findIndex((l) => l.includes('Dynamic workflow "research" completed'));
    const thoughtIdx = plain.findIndex((l) => l.includes("Thought for"));
    expect(eventIdx).toBeGreaterThanOrEqual(0);
    expect(thoughtIdx).toBeGreaterThan(eventIdx);
    expect(plain.filter((l) => l.includes("Thought for"))).toHaveLength(1);
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
    turn.expandedToolGroups.add("t-collapse:activity:0");
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
    turn.expandedToolGroups.add("t-bash-exec:activity:0");
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("ran 1 shell command"))).toBe(true);
    expect(plain.some((l) => l.includes("Bash(python3 add.py 15.6 28.3)"))).toBe(true);
    expect(plain.some((l) => l.includes("计算结果: 15.6 + 28.3 = 43.9"))).toBe(true);
  });

  it("merges waiting compact tools into the same activity batch", () => {
    const now = Date.now();
    const turn = baseTurn({
      phase: "thinking",
      timeline: [
        {
          type: "thinking",
          text: "scan repo",
          startedAt: now - 5000,
          lastChunkAt: now - 4000,
          endedAt: now - 4000,
        },
        {
          type: "tool",
          id: "tool-1",
          name: "Bash",
          detail: "ls -la /proj",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "tool",
          id: "tool-2",
          name: "Read",
          detail: "a.md",
          status: "waiting",
          dotFrame: 1,
        },
        {
          type: "tool",
          id: "tool-3",
          name: "Read",
          detail: "b.md",
          status: "success",
          dotFrame: 0,
        },
        {
          type: "tool",
          id: "tool-4",
          name: "Read",
          detail: "c.md",
          status: "success",
          dotFrame: 0,
        },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(
      plain.filter((l) => l.includes("Thought for") && l.includes("click to expand")).length,
    ).toBe(1);
    expect(plain.filter((l) => l.includes("⏺ read 1 file"))).toHaveLength(0);
    expect(plain.filter((l) => l.trim().startsWith("Waiting"))).toHaveLength(0);

    turn.expandedToolGroups.add(`${turn.id}:activity:0`);
    const expanded = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(expanded.some((l) => l.includes("Waiting") && l.includes("Reading"))).toBe(false);

    const activeExpanded = renderTurnToLines(turn, 120, { isActive: true }).map((l) =>
      stripAnsi(l.text),
    );
    expect(activeExpanded.some((l) => l.includes("Waiting") && l.includes("Reading"))).toBe(false);
    expect(collectLiveWaitingPinLines(turn).some((l) => stripAnsi(l).includes("Waiting"))).toBe(
      true,
    );
  });

  it("keeps live Explore/Agent in the chat timeline (not the Waiting pin)", () => {
    const turn = baseTurn({
      phase: "thinking",
      timeline: [
        {
          type: "tool",
          id: "agent-1",
          name: "Agent",
          detail: "description: explore APIs",
          status: "waiting",
          dotFrame: 2,
          toolInput: { description: "explore APIs", subagent_type: "explore" },
        },
      ],
    });
    const timeline = renderTurnToLines(turn, 120, { isActive: true }).map((l) => stripAnsi(l.text));
    expect(timeline.some((l) => /Explore\(explore APIs\)/i.test(l))).toBe(true);
    expect(timeline.some((l) => l.includes("Initializing"))).toBe(true);
    const pins = collectLiveWaitingPinLines(turn).map((l) => stripAnsi(l));
    expect(pins.some((l) => l.includes("Delegating"))).toBe(false);
  });

  it("hides approval-gated waiting Read from the active timeline", () => {
    const turn = baseTurn({
      phase: "thinking",
      timeline: [
        {
          type: "tool",
          id: "read-1",
          name: "Read",
          detail: "/tmp/a.md",
          status: "waiting",
          awaitingApproval: true,
          dotFrame: 2,
        },
      ],
    });
    const timeline = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    expect(timeline.some((l) => l.includes("Waiting"))).toBe(false);
  });

  it("still pins non-Agent live waiting tools outside the timeline (helper only)", () => {
    const turn = baseTurn({
      phase: "thinking",
      timeline: [
        {
          type: "tool",
          id: "read-1",
          name: "Read",
          detail: "/tmp/a.md",
          status: "waiting",
          dotFrame: 2,
        },
      ],
    });
    const timeline = renderTurnToLines(turn, 120, { isActive: true }).map((l) => stripAnsi(l.text));
    expect(timeline.some((l) => l.includes("Waiting"))).toBe(false);
    // Pins are not painted in the chat viewport — status line carries the live phase.
    const pins = collectLiveWaitingPinLines(turn).map((l) => stripAnsi(l));
    expect(pins.some((l) => l.includes("Waiting...") && l.includes("Reading"))).toBe(true);
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

  it("shows * recap: whenever recapText is set, including outside planMode", () => {
    const finishedAt = Date.now();
    const turn = baseTurn({
      userText: "continue",
      answerText: "Next we will update the footer.",
      phase: "done",
      finishedAt,
      planMode: false,
      recapText: "Goal: footer parity. Next: ship auto mode.",
      timeline: [
        {
          type: "answer",
          text: "Next we will update the footer.",
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("* recap: Goal: footer parity. Next: ship auto mode."))).toBe(
      true,
    );
    const answerIdx = plain.findIndex((l) => l.includes("Next we will update the footer."));
    const cookedIdx = plain.findIndex((l) => /\* \w+ for /.test(l));
    const recapIdx = plain.findIndex((l) => l.includes("* recap:"));
    expect(answerIdx).toBeGreaterThanOrEqual(0);
    expect(cookedIdx).toBeGreaterThan(answerIdx);
    expect(plain[cookedIdx - 1]?.trim()).toBe("");
    // * Cooked and * recap must not sit flush — one blank between status lines.
    expect(recapIdx).toBe(cookedIdx + 2);
    expect(plain[recapIdx - 1]?.trim()).toBe("");
  });

  it("keeps a blank between final answer and * Done / * recap system lines", () => {
    const turn = baseTurn({
      userText: "analyze",
      phase: "done",
      finishedAt: Date.now(),
      doneVerb: "Pondered",
      recapText: "Completed analysis of the Go AI Serv project.",
      timeline: [
        {
          type: "answer",
          text: "这是一个生产就绪的 AI 服务聚合平台，设计规范、扩展性强！",
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    const answerIdx = plain.findIndex((l) => l.includes("生产就绪"));
    const doneIdx = plain.findIndex((l) => l.includes("* Pondered"));
    const recapIdx = plain.findIndex((l) => l.includes("* recap:"));
    expect(answerIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBe(answerIdx + 2);
    expect(plain[doneIdx - 1]?.trim()).toBe("");
    expect(recapIdx).toBe(doneIdx + 2);
    expect(plain[recapIdx - 1]?.trim()).toBe("");
  });

  it("keeps Explore nested └ children tight while spacing main blocks", () => {
    const turn = baseTurn({
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        { type: "answer", text: "Starting explore." },
        {
          type: "tool",
          id: "agent-1",
          name: "Agent",
          detail: "scan",
          status: "success",
          agentExpanded: false,
          startedAt: Date.now() - 5000,
          endedAt: Date.now(),
          outputTokens: 0,
          toolInput: { subagent_type: "explore", description: "scan" },
          childTools: [
            {
              type: "tool",
              id: "c1",
              name: "Read",
              detail: "a.go",
              status: "success",
              dotFrame: 0,
            },
          ],
          dotFrame: 0,
        },
        { type: "answer", text: "Done exploring." },
      ],
    });
    const plain = renderTurnToLines(turn, 120).map((l) => stripAnsi(l.text));
    const exploreIdx = plain.findIndex((l) => /Explore\(scan\)/i.test(l));
    const doneChildIdx = plain.findIndex((l) => /Done \(\d+ tool uses?/.test(l));
    const finalIdx = plain.findIndex((l) => l.includes("Done exploring."));
    expect(exploreIdx).toBeGreaterThanOrEqual(0);
    expect(doneChildIdx).toBe(exploreIdx + 1); // nested └ stays flush under Explore
    expect(finalIdx).toBeGreaterThan(doneChildIdx);
    expect(plain[finalIdx - 1]?.trim()).toBe(""); // blank before next main answer
  });

  it("does not render silentChat protocol turns (recap wake thinking stays off-chat)", () => {
    const turn = baseTurn({
      userText: "",
      harnessOnly: true,
      silentChat: true,
      phase: "thinking",
      timeline: [
        {
          type: "thinking",
          text: "用户离开后回来，需要一个简要的回顾。",
          startedAt: Date.now() - 1000,
          lastChunkAt: Date.now(),
          endedAt: null,
        },
      ],
    });
    expect(renderTurnToLines(turn, 100, { isActive: true })).toEqual([]);
    expect(renderTurnToLines({ ...turn, phase: "done", finishedAt: Date.now() }, 100)).toEqual([]);
  });

  it("renders task-list timeline entries as a checklist block", () => {
    const turn = baseTurn({
      userText: "plan the work",
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "task-list",
          items: [
            { id: "1", subject: "Add mode footer", status: "completed" },
            { id: "2", subject: "Wire slash commands", status: "pending" },
          ],
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("Add mode footer"))).toBe(true);
    expect(plain.some((l) => l.includes("Wire slash commands"))).toBe(true);
  });

  it("omits recap line when recapText is unset", () => {
    const finishedAt = Date.now();
    const turn = baseTurn({
      userText: "continue",
      answerText: "Done.",
      phase: "done",
      finishedAt,
      planMode: true,
      timeline: [{ type: "answer", text: "Done." }],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("* recap:"))).toBe(false);
  });

  it("renders bare /plan harness turn without done duration", () => {
    const finishedAt = Date.now();
    const turn = baseTurn({
      userText: "/plan",
      phase: "done",
      finishedAt,
      harnessOnly: true,
      timeline: [
        {
          type: "event",
          lines: ["└ Enabled plan mode"],
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    const planIdx = plain.findIndex((l) => l.includes("> /plan"));
    const enabledIdx = plain.findIndex((l) => l.includes("Enabled plan mode"));
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(enabledIdx).toBe(planIdx + 1);
    expect(plain.some((l) => l.includes("Worked for") || l.includes("* "))).toBe(false);
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
    const body = plain.find((l) => l.includes("Plan") && l.includes("│"));
    expect(body).toMatch(/│.*│$/);
    expect(plain.some((l) => /└─+┘/.test(l))).toBe(true);
  });

  it("renders agent finished event line", () => {
    const turn = baseTurn({
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        {
          type: "event",
          lines: ['└ Agent "Explore vector API patterns" finished'],
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes('Agent "Explore vector API patterns" finished'))).toBe(
      true,
    );
  });

  it("renders /plan preview with Current Plan, path, and bordered box", () => {
    const turn = baseTurn({
      phase: "done",
      finishedAt: Date.now(),
      harnessOnly: true,
      userText: "/plan",
      timeline: [
        {
          type: "plan-preview",
          planPath: "/Users/me/.kako/plans/api-purrfect-wren.md",
          planText: "# Vector API plan\n\n## Context\n\nExpose search.",
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    expect(plain.some((l) => l.includes("Current Plan"))).toBe(true);
    expect(plain.some((l) => l.includes("api-purrfect-wren.md"))).toBe(true);
    expect(plain.some((l) => l.includes("┌"))).toBe(true);
    const body = plain.find((l) => l.includes("Vector API plan") && l.includes("│"));
    expect(body).toMatch(/│.*│$/);
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

  it("keeps consistent blank lines between answer, Thought, and choice blocks", () => {
    const turn = baseTurn({
      phase: "done",
      finishedAt: Date.now(),
      timeline: [
        { type: "answer", text: "先确认调研方向。" },
        {
          type: "thinking",
          text: "ask user",
          startedAt: Date.now() - 2000,
          lastChunkAt: Date.now() - 1000,
          endedAt: Date.now() - 1000,
        },
        {
          type: "choice",
          id: "choice-1",
          header: "调研方向",
          question: "选哪个方向？",
          answer: "Option A",
          multiSelect: false,
          options: [
            { label: "Option A", description: "A" },
            { label: "Option B", description: "B" },
          ],
        },
      ],
    });
    const plain = renderTurnToLines(turn, 100).map((l) => stripAnsi(l.text));
    const answerIdx = plain.findIndex((l) => l.includes("先确认调研方向"));
    const thoughtIdx = plain.findIndex((l) => l.includes("Thought for"));
    const choiceIdx = plain.findIndex((l) => l.includes("[调研方向]"));
    expect(answerIdx).toBeGreaterThanOrEqual(0);
    expect(thoughtIdx).toBeGreaterThan(answerIdx);
    expect(choiceIdx).toBeGreaterThan(thoughtIdx);
    expect(plain[answerIdx + 1]).toBe("");
    expect(plain[thoughtIdx + 1]).toBe("");
    // No double blanks between blocks.
    expect(plain[answerIdx + 2]).not.toBe("");
    expect(plain[thoughtIdx + 2]).not.toBe("");
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
