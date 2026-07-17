import { describe, expect, it } from "vitest";
import type { SessionMeta } from "@kako/shared";
import { stripAnsi } from "./ansi.js";
import {
  agentsFooter,
  agentsPanelHitTest,
  agentsSessionPreview,
  buildAgentsRows,
  clampAgentsListScrollRange,
  classifySessionBucket,
  createAgentsPanelState,
  formatRelativeTime,
  formatAgentsCwdPreview,
  formatAgentsIdlePreview,
  idlePreviewPrompt,
  lastSubstantiveTranscriptPreview,
  renderAgentsScreen,
  resolveAgentsListPreview,
  sessionListIcon,
  summaryPreviewLine,
  truncateStart,
  workingSessionIcon,
  interruptedPreviewCue,
  type AgentsPanelState,
} from "./agents-panel.js";
import { ansi, displayWidth } from "./ansi.js";

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

describe("classifySessionBucket", () => {
  it("ignores agentState.detail status phrases for list preview", () => {
    expect(
      agentsSessionPreview(
        meta({
          id: "s1",
          cwd: "/tmp",
          agentState: {
            state: "done",
            detail: "turn finished",
            tempo: "idle",
            since: "2026-07-14T00:00:00.000Z",
          },
        }),
        "你好！很高兴见到你",
      ),
    ).toBe("你好！很高兴见到你");
  });

  it("falls back to idle prompt + cwd when no content", () => {
    const preview = agentsSessionPreview(
      meta({
        id: "s1",
        cwd: "/tmp/workspace2",
        agentState: {
          state: "done",
          detail: "turn finished",
          tempo: "idle",
          since: "2026-07-14T00:00:00.000Z",
        },
      }),
      "",
    );
    expect(preview).toBe(`${idlePreviewPrompt("s1")} · /tmp/workspace2`);
  });

  it("picks idle prompt stably per session id", () => {
    expect(idlePreviewPrompt("sess-aaaa")).toBe(idlePreviewPrompt("sess-aaaa"));
    expect(
      new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => idlePreviewPrompt(id))).size,
    ).toBeGreaterThan(1);
  });

  it("formats idle preview with front-truncated cwd under budget", () => {
    const line = formatAgentsIdlePreview(
      "sess-x",
      "/very/long/path/to/my/workspace2",
      48,
    );
    expect(line).toContain(idlePreviewPrompt("sess-x"));
    expect(line).toMatch(/workspace2$/);
    expect(line).toMatch(/^[^…].* · …/);
  });

  it("front-truncates long cwd so the tail stays visible", () => {
    expect(truncateStart("/Users/hegeng/Documents/work/coding/github/kako", 18)).toBe(
      "…oding/github/kako",
    );
    expect(formatAgentsCwdPreview("/very/long/path/to/my/workspace2", 20)).toMatch(
      /workspace2$/,
    );
    expect(formatAgentsCwdPreview("/very/long/path/to/my/workspace2", 20)).toMatch(/^…/);
  });

  it("shows ellipsis while preview is still loading", () => {
    expect(
      agentsSessionPreview(meta({ id: "s1", cwd: "/tmp" }), undefined),
    ).toBe("…");
  });

  it("reads last substantive transcript including non-protocol llmText", () => {
    expect(
      lastSubstantiveTranscriptPreview([
        { role: "user", content: "", metadata: { llmText: "<task-notification>x</task-notification>" } },
        { role: "user", content: "", metadata: { llmText: "帮我看一下 Option A" } },
      ]),
    ).toBe("帮我看一下 Option A");
  });

  it("skips SYSTEM NOTIFICATION / stepped-away protocol wakes in Agents preview", () => {
    expect(
      lastSubstantiveTranscriptPreview([
        { role: "user", content: "帮我合并 LLM 与 agent 方案" },
        { role: "assistant", content: "可以，先对齐目标与边界。" },
        {
          role: "user",
          content: "",
          metadata: {
            llmText:
              "[SYSTEM NOTIFICATION — NOT USER INPUT]\n<stepped-away-recap/>\nThe user stepped away and is coming back.",
          },
        },
      ]),
    ).toBe("可以，先对齐目标与边界。");

    expect(
      lastSubstantiveTranscriptPreview([
        { role: "user", content: "继续 Option A" },
        {
          role: "assistant",
          content:
            "[SYSTEM NOTIFICATION - NOT USER INPUT] The user stepped away and is coming back.",
        },
      ]),
    ).toBe("继续 Option A");
  });

  it("skips protocol lines when reading summary Goal/body for preview", () => {
    expect(
      summaryPreviewLine(`## Goal

[SYSTEM NOTIFICATION - NOT USER INPUT] The user stepped away

## Next

Wait
`),
    ).toBe("Wait");
  });

  it("prefers latest transcript snippet over stale Goal summary", () => {
    expect(
      resolveAgentsListPreview({
        summaryMarkdown: `---\ncompactGeneration: 1\n---\n\n## Goal\n\nTrack Option A height\n\n## Next\n\nWait\n`,
        transcriptPreview: "我在的！随时准备帮助你",
      }),
    ).toBe("我在的！随时准备帮助你");
  });

  it("does not use legacy Session Summary heading as preview", () => {
    expect(
      summaryPreviewLine(`# Session Summary

Session: sess-x
Messages: 4

**user**: 帮我记录宝宝身高
**assistant**: 记录提交成功！
`),
    ).toBe("帮我记录宝宝身高");
  });

  it("uses Goal when transcript preview is empty", () => {
    expect(
      resolveAgentsListPreview({
        summaryMarkdown: `## Goal\n\nTrack Option A height\n`,
        transcriptPreview: "",
      }),
    ).toBe("Track Option A height");
  });

  it("uses transcript when summary Goal is empty", () => {
    expect(
      resolveAgentsListPreview({
        summaryMarkdown: `## Goal\n\n(none)\n`,
        transcriptPreview: "记录提交成功",
      }),
    ).toBe("记录提交成功");
  });

  it("classifies blocked as needs_input", () => {
    expect(
      classifySessionBucket(
        meta({
          id: "s1",
          cwd: "/tmp",
          agentState: {
            state: "blocked",
            detail: "waiting",
            tempo: "blocked",
            since: "2026-07-14T00:00:00.000Z",
          },
        }),
      ),
    ).toBe("needs_input");
  });

  it("classifies working state as working", () => {
    expect(
      classifySessionBucket(
        meta({
          id: "s1",
          cwd: "/tmp",
          agentState: {
            state: "working",
            detail: "running",
            tempo: "active",
            since: "2026-07-14T00:00:00.000Z",
          },
        }),
      ),
    ).toBe("working");
  });

  it("classifies ended as completed", () => {
    expect(classifySessionBucket(meta({ id: "s1", cwd: "/tmp", status: "ended" }))).toBe(
      "completed",
    );
  });

  it("classifies done sessions with running background work as working", () => {
    expect(
      classifySessionBucket(
        meta({
          id: "s-bg",
          cwd: "/tmp",
          agentState: {
            state: "done",
            detail: "workflow started",
            tempo: "idle",
            since: "2026-07-14T00:00:00.000Z",
          },
        }),
        new Set(["s-bg"]),
      ),
    ).toBe("working");
  });

  it("blocked (needs user input) beats running background work", () => {
    expect(
      classifySessionBucket(
        meta({
          id: "s-bg",
          cwd: "/tmp",
          agentState: {
            state: "blocked",
            detail: "need approval",
            tempo: "blocked",
            since: "2026-07-14T00:00:00.000Z",
          },
        }),
        new Set(["s-bg"]),
      ),
    ).toBe("needs_input");
  });

  it("live BG stays working when agentState is working", () => {
    expect(
      classifySessionBucket(
        meta({
          id: "s-bg",
          cwd: "/tmp",
          agentState: {
            state: "working",
            detail: "running turn",
            tempo: "active",
            since: "2026-07-14T00:00:00.000Z",
          },
        }),
        new Set(["s-bg"]),
      ),
    ).toBe("working");
  });

  it("interrupted (no live BG) goes to needs_input even if agentState is working", () => {
    expect(
      classifySessionBucket(
        meta({
          id: "s-int",
          cwd: "/tmp",
          agentState: {
            state: "working",
            detail: "research",
            tempo: "active",
            since: "2026-07-14T00:00:00.000Z",
          },
        }),
        new Set(),
        new Set(["s-int"]),
      ),
    ).toBe("needs_input");
  });

  it("interrupted checkpoint puts even ended sessions in needs_input", () => {
    expect(
      classifySessionBucket(
        meta({
          id: "s-int",
          cwd: "/tmp",
          status: "ended",
          agentState: {
            state: "done",
            detail: "finished",
            tempo: "idle",
            since: "2026-07-14T00:00:00.000Z",
          },
        }),
        new Set(),
        new Set(["s-int"]),
      ),
    ).toBe("needs_input");
  });

  it("live BG beats stale interrupted checkpoints (soft-resume owns the work)", () => {
    expect(
      classifySessionBucket(
        meta({
          id: "s-int",
          cwd: "/tmp",
          agentState: {
            state: "working",
            detail: "research",
            tempo: "active",
            since: "2026-07-14T00:00:00.000Z",
          },
        }),
        new Set(["s-int"]),
        new Set(["s-int"]),
      ),
    ).toBe("working");
  });

  it("buckets background-running sessions under Working in the list", () => {
    const rows = buildAgentsRows(
      [
        meta({
          id: "s-bg",
          cwd: "/tmp",
          title: "deep research",
          agentState: {
            state: "done",
            detail: "workflow started",
            tempo: "idle",
            since: "2026-07-14T00:00:00.000Z",
          },
        }),
      ],
      { "s-bg": "workflow running" },
      { needs_input: false, working: false, completed: false },
      [],
      "s-bg",
      undefined,
      undefined,
      new Set(["s-bg"]),
    );
    expect(rows.find((r) => r.kind === "group" && r.bucket === "working")).toMatchObject({
      count: 1,
    });
    expect(rows.find((r) => r.kind === "session" && r.sessionId === "s-bg")).toMatchObject({
      bucket: "working",
    });
  });
});

describe("interruptedPreviewCue", () => {
  it("formats workflow and agent cues", () => {
    expect(
      interruptedPreviewCue([
        { kind: "workflow", name: "deep-research", description: "Deep research" },
      ]),
    ).toBe("interrupted · deep-research");
    expect(
      interruptedPreviewCue([{ kind: "agent", description: "Explore Option A" }]),
    ).toBe("interrupted · agent: Explore Option A");
    expect(interruptedPreviewCue([])).toBeUndefined();
  });
});

describe("agentsFooter", () => {
  function baseState(): AgentsPanelState {
    return createAgentsPanelState({
      entryCwd: "/tmp/demo",
      entrySessionId: "sess-1",
      modelLabel: "model",
      version: "0.2.2",
      metas: [
        meta({ id: "sess-1", cwd: "/tmp/demo", title: "One" }),
        meta({
          id: "sess-2",
          cwd: "/tmp/other",
          title: "Two",
          status: "ended",
          updatedAt: "2026-07-13T00:00:00.000Z",
        }),
      ],
    });
  }

  it("shows session shortcuts", () => {
    const state = baseState();
    const idx = state.rows.findIndex((r) => r.kind === "session");
    state.selectedIndex = idx;
    expect(stripAnsi(agentsFooter(state))).toContain("enter to open");
    expect(stripAnsi(agentsFooter(state))).toContain("space to reply");
  });

  it("shows group collapse shortcut", () => {
    const state = baseState();
    const idx = state.rows.findIndex((r) => r.kind === "group");
    state.selectedIndex = idx;
    expect(stripAnsi(agentsFooter(state))).toContain("enter to collapse");
    expect(stripAnsi(agentsFooter(state))).toContain("delete all");
  });

  it("shows confirm when delete armed", () => {
    const state = baseState();
    state.deleteArm = { target: "session", sessionId: "sess-1" };
    expect(stripAnsi(agentsFooter(state))).toContain("ctrl+x to confirm");
  });

  it("shows double ctrl+c exit hint when armed", () => {
    const state = baseState();
    expect(stripAnsi(agentsFooter(state, true))).toBe("Press Ctrl+C again to exit");
  });
});

describe("buildAgentsRows / render", () => {
  it("excludes child/subagent sessions (parentSessionId) from both list builders", () => {
    const metas = [
      meta({ id: "main-a", cwd: "/tmp", title: "Main chat" }),
      meta({
        id: "child-explore",
        cwd: "/tmp",
        title: "Explore find auth",
        parentSessionId: "main-a",
      }),
      meta({ id: "main-b", cwd: "/tmp", title: "Other main", status: "ended" }),
    ];
    const rows = buildAgentsRows(
      metas,
      { "main-a": "hello", "child-explore": "should not show", "main-b": "bye" },
      { needs_input: false, working: false, completed: false },
      [],
      "main-a",
    );
    const sessionIds = rows.filter((r) => r.kind === "session").map((r) => r.sessionId);
    expect(sessionIds).toEqual(["main-a", "main-b"]);
    expect(sessionIds).not.toContain("child-explore");

    // Header tally path (tallyFromMetas) must use the same parentSessionId filter.
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "main-a",
      modelLabel: "m",
      version: "0.2.2",
      metas,
    });
    expect(state.rows.filter((r) => r.kind === "session").map((r) => r.sessionId)).toEqual([
      "main-a",
      "main-b",
    ]);
    const painted = renderAgentsScreen(state, 80, 30, metas).lines.map(stripAnsi).join("\n");
    expect(painted).not.toContain("Explore find auth");
    expect(painted).not.toContain("child-explore");
  });

  it("hides stale AI titles when the session transcript is empty", () => {
    const metas = [
      meta({
        id: "empty-titled",
        cwd: "/tmp/go_ai_serv",
        title: "梳理项目 LLM/agent 调用接入方式",
        jobLabel: "go llm factory summary",
      }),
    ];
    const rows = buildAgentsRows(
      metas,
      { "empty-titled": "" },
      { needs_input: false, working: false, completed: false },
      [],
    );
    expect(rows.find((r) => r.kind === "session")).toMatchObject({
      title: "new session",
      idleCwdPreview: true,
    });
  });

  it("labels entry session as current session and defaults as new session", () => {
    const metas = [
      meta({ id: "entry", cwd: "/tmp", title: "New chat" }),
      meta({ id: "other", cwd: "/tmp", title: "New chat" }),
      meta({ id: "named", cwd: "/tmp", title: "initial tech greeting" }),
      meta({
        id: "job-only",
        cwd: "/tmp",
        title: "new session",
        jobLabel: "baby profile lookup",
      }),
    ];
    const rows = buildAgentsRows(
      metas,
      {
        entry: "",
        other: "",
        named: "hello from named",
        "job-only": "",
      },
      { needs_input: false, working: false, completed: false },
      [],
      "entry",
    );
    const sessions = rows.filter((r) => r.kind === "session");
    expect(sessions.find((r) => r.kind === "session" && r.sessionId === "entry")).toMatchObject({
      title: "current session",
      preview: `${idlePreviewPrompt("entry")} · /tmp`,
      idleCwdPreview: true,
    });
    expect(sessions.find((r) => r.kind === "session" && r.sessionId === "other")).toMatchObject({
      title: "new session",
      preview: `${idlePreviewPrompt("other")} · /tmp`,
      idleCwdPreview: true,
    });
    expect(sessions.find((r) => r.kind === "session" && r.sessionId === "named")).toMatchObject({
      title: "initial tech greeting",
      preview: "hello from named",
    });
    expect(sessions.find((r) => r.kind === "session" && r.sessionId === "job-only")).toMatchObject({
      // Empty transcript: do not surface stale jobLabel as the list title.
      title: "new session",
      idleCwdPreview: true,
    });

    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "entry",
      modelLabel: "m",
      version: "0.2.2",
      metas,
    });
    const painted = renderAgentsScreen(state, 80, 30, metas).lines.join("\n");
    expect(painted).toContain(`${ansi.blue}current session`);
  });

  it("inserts a blank line between group sections", () => {
    const metas = [
      meta({ id: "a", cwd: "/tmp", title: "Need", status: "active" }),
      meta({ id: "b", cwd: "/tmp", title: "Done", status: "ended" }),
    ];
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "a",
      modelLabel: "m",
      version: "0.2.2",
      metas,
    });
    const { lines } = renderAgentsScreen(state, 80, 30, metas, state.openedAt);
    const plain = lines.map((l) => stripAnsi(l));
    const needsIdx = plain.findIndex((l) => l.includes("Needs input"));
    const completedIdx = plain.findIndex((l) => l.includes("Completed"));
    expect(needsIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThan(needsIdx + 1);
    expect(plain.slice(needsIdx + 1, completedIdx).some((l) => l.trim() === "")).toBe(true);
  });

  it("keeps selected CJK session rows within terminal width", () => {
    const longPreview =
      "已成功为小航宝记录生长数据，身高体重都记下了。沃飞长空与吉利科技在低空经济领域的合作正在推进，上传接口开发已完成并通过联调。";
    const metas = [
      meta({
        id: "s1",
        cwd: "/tmp",
        title: "开发一个上传接口",
        status: "ended",
      }),
    ];
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "s1",
      modelLabel: "m",
      version: "0.2.2",
      metas,
      previews: { s1: longPreview },
    });
    const cols = 80;
    const { lines } = renderAgentsScreen(state, cols, 24, metas);
    const selected = lines.find((l) => l.includes(ansi.userMessageBg));
    expect(selected).toBeDefined();
    expect(displayWidth(selected!)).toBeLessThanOrEqual(cols);
    expect(stripAnsi(selected!).includes("\n")).toBe(false);
  });

  it("aligns name and time columns across session rows", () => {
    const metas = [
      meta({ id: "a", cwd: "/tmp", title: "short", updatedAt: "2026-07-14T11:59:00.000Z" }),
      meta({
        id: "b",
        cwd: "/tmp",
        title: "a much longer session name here",
        updatedAt: "2026-07-14T11:00:00.000Z",
      }),
    ];
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "a",
      modelLabel: "m",
      version: "0.2.2",
      metas,
      previews: {
        a: "preview one",
        b: "preview two is longer text",
      },
      answerDurations: { a: 12_000, b: 125_000 },
      openedAt: Date.parse("2026-07-14T12:00:00.000Z"),
    });
    const { lines } = renderAgentsScreen(state, 80, 30, metas, state.openedAt);
    const sessionLines = lines
      .map((l) => stripAnsi(l))
      .filter((l) => l.includes("preview one") || l.includes("preview two"))
      .map((l) => l.trimEnd());
    expect(sessionLines.length).toBe(2);
    // Time is a fixed 4-col suffix; content before it must share the same width.
    expect(sessionLines[0]!.slice(0, -4).length).toBe(sessionLines[1]!.slice(0, -4).length);
    expect(sessionLines[0]!.slice(-4).trim()).toMatch(/^\d+[smhd]$/);
    expect(sessionLines[1]!.slice(-4).trim()).toMatch(/^\d+[smhd]$/);
  });

  it("shows summed model answer duration not session age", () => {
    const metaRow = meta({
      id: "a",
      cwd: "/tmp",
      title: "named",
      updatedAt: "2026-07-14T11:59:50.000Z",
    });
    const openedAt = Date.parse("2026-07-14T12:00:00.000Z");
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "other",
      modelLabel: "m",
      version: "0.2.2",
      metas: [metaRow],
      answerDurations: { a: 45_000 },
      openedAt,
    });
    expect(stripAnsi(renderAgentsScreen(state, 80, 24, [metaRow]).lines.join("\n"))).toMatch(
      /\b45s\b/,
    );
  });

  it("hides zero answer duration in the time column", () => {
    const metaRow = meta({ id: "a", cwd: "/tmp", title: "new session" });
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "a",
      modelLabel: "m",
      version: "0.2.2",
      metas: [metaRow],
      previews: { a: "send a prompt to start" },
      answerDurations: { a: 0 },
    });
    const line = renderAgentsScreen(state, 80, 24, [metaRow])
      .lines.map((l) => stripAnsi(l))
      .find((l) => l.includes("send a prompt to start"));
    expect(line).toBeDefined();
    expect(line).not.toContain("0s");
  });

  it("collapses completed with count", () => {
    const metas = Array.from({ length: 6 }, (_, i) =>
      meta({
        id: `sess-${i}`,
        cwd: "/tmp",
        title: `Done ${i}`,
        status: "ended",
        updatedAt: `2026-07-0${(i % 9) + 1}T00:00:00.000Z`,
      }),
    );
    const rows = buildAgentsRows(
      metas,
      {},
      { needs_input: false, working: false, completed: true },
      [],
    );
    const group = rows.find((r) => r.kind === "group" && r.bucket === "completed");
    expect(group).toMatchObject({ kind: "group", collapsed: true, count: 6 });
    expect(rows.some((r) => r.kind === "session" && r.bucket === "completed")).toBe(false);

    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "sess-0",
      modelLabel: "m",
      version: "0.2.2",
      metas,
    });
    state.collapsed.completed = true;
    state.rows = buildAgentsRows(metas, {}, state.collapsed, [], state.entrySessionId);
    const screen = stripAnsi(renderAgentsScreen(state, 80, 30, metas).lines.join("\n"));
    expect(screen).toMatch(/Completed\s+6/);
    expect(screen).toContain("Kako");
    expect(screen).toContain("describe a task for a new session");
  });

  it("keeps compose and footer visible when the list is long", () => {
    const metas = Array.from({ length: 40 }, (_, i) =>
      meta({
        id: `sess-${i}`,
        cwd: "/tmp",
        title: `Item ${i}`,
        status: i < 3 ? "active" : "ended",
        updatedAt: `2026-07-01T00:${String(i).padStart(2, "0")}:00.000Z`,
      }),
    );
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "sess-0",
      modelLabel: "seed-2.0-pro",
      agentName: "main",
      version: "0.2.2",
      metas,
    });
    const { lines } = renderAgentsScreen(state, 80, 24, metas, state.openedAt);
    expect(lines).toHaveLength(24);
    const plain = lines.map((l) => stripAnsi(l));
    expect(plain[plain.length - 1]).toContain("enter to open");
    expect(plain[plain.length - 2]).toMatch(/^─+$/);
    expect(plain[plain.length - 3]).toContain("describe a task");
    expect(plain[plain.length - 4]).toMatch(/^─+$/);
    expect(plain.some((l) => l.includes("Kako") && l.includes("v0.2.2"))).toBe(true);
    expect(plain.some((l) => l.includes("seed-2.0-pro") && l.includes("main agent"))).toBe(true);
  });

  it("renders unfocused compose placeholder in full", () => {
    const metas = [meta({ id: "a", cwd: "/tmp", title: "named" })];
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "a",
      modelLabel: "m",
      version: "0.2.2",
      metas,
    });
    state.composeFocus = false;
    const blurred = renderAgentsScreen(state, 80, 24, metas).lines.map((l) => stripAnsi(l));
    expect(blurred.some((l) => l.includes("describe a task for a new session"))).toBe(true);
  });

  it("renders multiline compose text like chat input", () => {
    const metas = [meta({ id: "a", cwd: "/tmp", title: "named" })];
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "a",
      modelLabel: "m",
      version: "0.2.2",
      metas,
    });
    state.composeFocus = true;
    state.composeBuffer = "你好啊\n第二行";
    state.composeCursor = state.composeBuffer.length;
    const plain = renderAgentsScreen(state, 80, 24, metas).lines.map((l) => stripAnsi(l));
    expect(plain.some((l) => l.includes("你好啊"))).toBe(true);
    expect(plain.some((l) => l.includes("第二行"))).toBe(true);
    expect(plain[plain.length - 2]).toMatch(/^─+$/);
    const topBorderIdx = plain.findLastIndex((l, i) => i < plain.length - 2 && /^─+$/.test(l));
    expect(topBorderIdx).toBeGreaterThanOrEqual(0);
    expect(plain[topBorderIdx + 1]).toContain("你好啊");
  });

  it("renders reply box with wrapped context and reply placeholder", () => {
    const metas = [
      meta({
        id: "sess-1",
        cwd: "/tmp",
        title: "interrupted tool request",
        status: "ended",
      }),
    ];
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "sess-1",
      modelLabel: "m",
      version: "0.2.2",
      metas,
      previews: {
        "sess-1":
          "Created code-reviewer subagent at /tmp/.claude/agents/code-reviewer.md using Claude Opus 4.8, specialized for structured code reviews covering bugs, best practices, performance and security issues",
      },
    });
    const sessionIdx = state.rows.findIndex(
      (r) => r.kind === "session" && r.sessionId === "sess-1",
    );
    state.selectedIndex = sessionIdx;
    state.mode = "reply";
    state.replySessionId = "sess-1";
    state.replyContext = state.previews["sess-1"];
    state.replyBuffer = "";
    state.composeFocus = true;
    const plain = renderAgentsScreen(state, 80, 30, metas).lines.map((l) => stripAnsi(l));
    expect(plain.some((l) => l.includes("Created code-reviewer subagent"))).toBe(true);
    // Focused empty reply uses Claude placeholder (block cursor overlays first letter).
    expect(plain.some((l) => l.includes("eply"))).toBe(true);
    expect(plain.some((l) => /^┌─+┐$/.test(l))).toBe(true);
    expect(plain.some((l) => /^└─+┘$/.test(l))).toBe(true);
    expect(plain.some((l) => l.startsWith("│") && l.endsWith("│"))).toBe(true);
    expect(plain[plain.length - 1]).toContain("space to close");
  });

  it("exports working icon frames of equal width with size pulse shapes", () => {
    const frames = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const glyph = workingSessionIcon(i, false);
      expect(displayWidth(glyph)).toBe(1);
      frames.add(glyph);
    }
    expect(frames.size).toBeGreaterThanOrEqual(4);
    expect(frames.has("*")).toBe(true);
  });

  it("uses yellow/muted/green/red icons and · / * for unread/read", () => {
    expect(sessionListIcon("needs_input", { unread: true })).toBe(`${ansi.yellow}·${ansi.reset}`);
    expect(sessionListIcon("needs_input", { unread: false })).toBe(`${ansi.yellow}*${ansi.reset}`);
    expect(sessionListIcon("working", { unread: true, pulseFrame: 0 })).toContain(ansi.muted);
    expect(displayWidth(stripAnsi(sessionListIcon("working", { unread: false, pulseFrame: 4 })))).toBe(
      1,
    );
    expect(sessionListIcon("completed", { unread: false })).toBe(`${ansi.green}*${ansi.reset}`);
    expect(sessionListIcon("completed", { unread: true, failed: true })).toBe(
      `${ansi.red}·${ansi.reset}`,
    );
  });

  it("marks unread from sessionVisits vs bucket entry time", () => {
    const metas = [
      meta({
        id: "read-me",
        cwd: "/tmp",
        title: "Seen",
        agentState: {
          state: "blocked",
          detail: "wait",
          tempo: "blocked",
          since: "2026-07-14T10:00:00.000Z",
        },
      }),
      meta({
        id: "fresh",
        cwd: "/tmp",
        title: "New",
        status: "ended",
        updatedAt: "2026-07-14T12:00:00.000Z",
      }),
    ];
    const rows = buildAgentsRows(
      metas,
      {},
      { needs_input: false, working: false, completed: false },
      [],
      undefined,
      new Map([["read-me", Date.parse("2026-07-14T11:00:00.000Z")]]),
    );
    const sessions = rows.filter((r) => r.kind === "session");
    expect(sessions.find((r) => r.sessionId === "read-me")).toMatchObject({ unread: false });
    expect(sessions.find((r) => r.sessionId === "fresh")).toMatchObject({ unread: true });
  });

  it("keeps completed entry session in Completed (no pin to Needs input)", () => {
    const metas = [
      meta({ id: "need", cwd: "/tmp", title: "Need A", status: "active" }),
      meta({ id: "need2", cwd: "/tmp", title: "Need B", status: "active" }),
      meta({
        id: "done-current",
        cwd: "/tmp",
        title: "Finished job",
        status: "ended",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    ];
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "done-current",
      modelLabel: "m",
      version: "0.2.2",
      metas,
    });
    const current = state.rows.find(
      (r) => r.kind === "session" && r.sessionId === "done-current",
    );
    expect(current).toMatchObject({
      kind: "session",
      title: "current session",
      bucket: "completed",
    });
    const needSessions = state.rows.filter(
      (r) => r.kind === "session" && r.bucket === "needs_input",
    );
    expect(needSessions.map((r) => (r.kind === "session" ? r.sessionId : ""))).toEqual([
      "need",
      "need2",
    ]);
  });

  it("restores preferred session selection instead of jumping to entry", () => {
    const metas = [
      meta({ id: "entry", cwd: "/tmp", title: "entry one" }),
      meta({ id: "mid", cwd: "/tmp", title: "middle", status: "ended" }),
      meta({ id: "tail", cwd: "/tmp", title: "tail", status: "ended" }),
    ];
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "entry",
      modelLabel: "m",
      version: "0.2.2",
      metas,
      preferredSessionId: "tail",
      listScrollOffset: 3,
    });
    const row = state.rows[state.selectedIndex];
    expect(row).toMatchObject({ kind: "session", sessionId: "tail" });
    expect(state.listScrollOffset).toBe(3);
  });

  it("allows free list scroll without pinning selection", () => {
    expect(clampAgentsListScrollRange(100, 20, 5)).toBe(15);
    expect(clampAgentsListScrollRange(-3, 20, 5)).toBe(0);
    const metas = Array.from({ length: 30 }, (_, i) =>
      meta({
        id: `sess-${i}`,
        cwd: "/tmp",
        title: `Item ${i}`,
        status: "ended",
        updatedAt: `2026-07-01T00:${String(i).padStart(2, "0")}:00.000Z`,
      }),
    );
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "sess-0",
      modelLabel: "m",
      version: "0.2.2",
      metas,
      listScrollOffset: 0,
    });
    state.listScrollOffset = 8;
    const free = renderAgentsScreen(state, 80, 24, metas, state.openedAt, {
      pinSelection: false,
    });
    expect(free.listScrollOffset).toBe(8);
  });

  it("hit-tests navigable rows from screen coordinates", () => {
    const metas = [
      meta({ id: "s1", cwd: "/tmp", title: "Alpha" }),
      meta({
        id: "s2",
        cwd: "/tmp",
        title: "Beta",
        status: "ended",
        updatedAt: "2026-07-13T00:00:00.000Z",
      }),
    ];
    const state = createAgentsPanelState({
      entryCwd: "/tmp",
      entrySessionId: "s1",
      modelLabel: "m",
      version: "0.2.2",
      metas,
      previews: { s1: "preview one", s2: "preview two" },
    });
    const cols = 80;
    const bodyRows = 24;
    const { lines } = renderAgentsScreen(state, cols, bodyRows, metas, state.openedAt);
    const plain = lines.map((l) => stripAnsi(l));

    const groupIdx = plain.findIndex((l) => l.includes("Needs input"));
    expect(groupIdx).toBeGreaterThanOrEqual(0);
    const groupHit = agentsPanelHitTest(state, groupIdx + 1, cols, bodyRows, metas, state.openedAt);
    expect(groupHit).not.toBeNull();
    expect(state.rows[groupHit!]).toMatchObject({ kind: "group", bucket: "needs_input" });

    const sessionIdx = plain.findIndex((l) => l.includes("Alpha") || l.includes("current session"));
    expect(sessionIdx).toBeGreaterThanOrEqual(0);
    const sessionHit = agentsPanelHitTest(
      state,
      sessionIdx + 1,
      cols,
      bodyRows,
      metas,
      state.openedAt,
    );
    expect(sessionHit).not.toBeNull();
    expect(state.rows[sessionHit!]).toMatchObject({ kind: "session", sessionId: "s1" });

    expect(agentsPanelHitTest(state, 1, cols, bodyRows, metas, state.openedAt)).toBeNull();
    expect(agentsPanelHitTest(state, bodyRows, cols, bodyRows, metas, state.openedAt)).toBeNull();
  });
});
