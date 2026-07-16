import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@kako/shared";
import {
  chatTurnsFromTranscript,
  reopenLastTranscriptTurn,
  rewindTurnsFromTranscript,
} from "./session-history.js";

function msg(partial: Partial<TranscriptMessage> & Pick<TranscriptMessage, "role" | "content">): TranscriptMessage {
  return {
    id: partial.id ?? `m-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: partial.timestamp ?? "2026-07-14T00:00:00.000Z",
    ...partial,
  };
}

describe("chatTurnsFromTranscript", () => {
  it("rebuilds user/assistant pairs", () => {
    const turns = chatTurnsFromTranscript([
      msg({ id: "u1", role: "user", content: "hello" }),
      msg({ id: "a1", role: "assistant", content: "hi there" }),
      msg({ id: "u2", role: "user", content: "next" }),
      msg({ id: "a2", role: "assistant", content: "ok" }),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.userText).toBe("hello");
    expect(turns[0]!.answerText).toBe("hi there");
    expect(turns[0]!.phase).toBe("done");
    expect(turns[0]!.timeline).toEqual([{ type: "answer", text: "hi there" }]);
    expect(turns[1]!.userText).toBe("next");
  });

  it("derives Done duration from user start to last model message", () => {
    const turns = chatTurnsFromTranscript([
      msg({
        id: "u1",
        role: "user",
        content: "hello",
        timestamp: "2026-07-14T00:00:00.000Z",
      }),
      msg({
        id: "a1",
        role: "assistant",
        content: "hi",
        timestamp: "2026-07-14T00:00:12.000Z",
      }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.thinkingStartedAt).toBe(Date.parse("2026-07-14T00:00:00.000Z"));
    expect(turns[0]!.finishedAt).toBe(Date.parse("2026-07-14T00:00:12.000Z"));
  });

  it("includes tool calls between assistants", () => {
    const turns = chatTurnsFromTranscript([
      msg({ id: "u1", role: "user", content: "read file" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "Read", input: { file_path: "/tmp/a.ts" } }],
      }),
      msg({
        id: "tr1",
        role: "tool",
        content: "export const x = 1",
        toolCallId: "t1",
        toolName: "Read",
      }),
      msg({ id: "a2", role: "assistant", content: "done" }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.timeline.map((e) => e.type)).toEqual(["tool", "answer"]);
    const tool = turns[0]!.timeline[0]!;
    expect(tool).toMatchObject({
      type: "tool",
      name: "Read",
      detail: "/tmp/a.ts",
      status: "success",
    });
    expect(turns[0]!.answerText).toBe("done");
  });

  it("does not style Skill-args / harness user rows as CLI prompts", () => {
    const turns = chatTurnsFromTranscript([
      msg({
        id: "u1",
        role: "user",
        content: "/deep-research 写一份母婴调研报告",
        metadata: { cliInput: true },
      }),
      msg({
        id: "a1",
        role: "assistant",
        content: "我需要先了解一些关键信息",
        toolCalls: [{ id: "q1", name: "AskUserQuestion", input: { questions: [] } }],
      }),
      msg({
        id: "tr1",
        role: "tool",
        content: 'Your questions have been answered: "读者"="投资者"',
        toolCallId: "q1",
        toolName: "AskUserQuestion",
      }),
      msg({
        id: "u2",
        role: "user",
        content: "中国母婴行业市场规模与趋势调研报告，面向投资者。",
        metadata: { harnessInjected: true },
      }),
      msg({
        id: "a2",
        role: "assistant",
        content: "好的，我来启动深度调研工作流",
        toolCalls: [
          {
            id: "w1",
            name: "Workflow",
            input: { name: "deep-research", args: "中国母婴…" },
          },
        ],
      }),
      msg({
        id: "tr2",
        role: "tool",
        content: "launched",
        toolCallId: "w1",
        toolName: "Workflow",
      }),
      msg({
        id: "a3",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "s1",
            name: "WebSearch",
            input: { query: "中国母婴行业市场规模" },
          },
        ],
      }),
      msg({
        id: "tr3",
        role: "tool",
        content: "search hits",
        toolCallId: "s1",
        toolName: "WebSearch",
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.userText).toBe("/deep-research 写一份母婴调研报告");
    expect(turns[0]!.userText).not.toContain("中国母婴行业市场");
    const names = turns[0]!.timeline
      .filter((e): e is Extract<(typeof turns)[0]["timeline"][number], { type: "tool" }> => e.type === "tool")
      .map((e) => e.name);
    expect(names).toEqual(["AskUserQuestion", "Workflow", "WebSearch"]);
  });

  it("folds non-cliInput user rows when the transcript uses cliInput markers", () => {
    const turns = chatTurnsFromTranscript([
      msg({
        id: "u1",
        role: "user",
        content: "帮我保存到文档里",
        metadata: { cliInput: true },
      }),
      msg({
        id: "u2",
        role: "user",
        content: '创建一份名为"报告.docx"的文档',
      }),
      msg({
        id: "a1",
        role: "assistant",
        content: "好的",
        toolCalls: [{ id: "b1", name: "Bash", input: { command: "ls" } }],
      }),
      msg({
        id: "tr1",
        role: "tool",
        content: "/tmp",
        toolCallId: "b1",
        toolName: "Bash",
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.userText).toBe("帮我保存到文档里");
    expect(turns[0]!.timeline.some((e) => e.type === "tool" && e.name === "Bash")).toBe(true);
  });

  it("reopens the last transcript turn so live Explore detail does not show * Done", () => {
    const turns = chatTurnsFromTranscript([
      msg({
        id: "u1",
        role: "user",
        content: "探索项目LLM",
        metadata: { cliInput: true },
      }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "Glob", input: { pattern: "**/*.go" } }],
      }),
      msg({
        id: "tr1",
        role: "tool",
        content: "a.go\nb.go",
        toolCallId: "t1",
        toolName: "Glob",
      }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.phase).toBe("done");
    expect(turns[0]!.finishedAt).not.toBeNull();

    const { completed, active } = reopenLastTranscriptTurn(turns);
    expect(completed).toHaveLength(0);
    expect(active).not.toBeNull();
    expect(active!.phase).toBe("thinking");
    expect(active!.finishedAt).toBeNull();
    expect(active!.doneVerb).toBeNull();
    expect(active!.timeline.some((e) => e.type === "tool" && e.name === "Glob")).toBe(true);
  });

  it("skips stepped-away-recap wakes so they never fold into chat turns", () => {
    const turns = chatTurnsFromTranscript([
      msg({
        id: "u1",
        role: "user",
        content: "摸清架构",
        metadata: { cliInput: true },
      }),
      msg({
        id: "a1",
        role: "assistant",
        content: "这是总结。",
      }),
      msg({
        id: "u2",
        role: "user",
        content: "",
        metadata: {
          llmText:
            "[SYSTEM NOTIFICATION — NOT USER INPUT]\n<stepped-away-recap/>\nWrite a brief recap.",
        },
      }),
      msg({
        id: "a2",
        role: "assistant",
        content: "已完成探索，等待下一步指示。",
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.userText).toBe("摸清架构");
    expect(turns[0]!.answerText).toBe("这是总结。");
    expect(turns[0]!.timeline.some((e) => e.type === "answer" && e.text.includes("等待下一步"))).toBe(
      false,
    );
  });
});

describe("rewindTurnsFromTranscript", () => {
  it("maps cliInput user rows to L0 indexes", () => {
    const anchors = rewindTurnsFromTranscript([
      msg({ id: "u1", role: "user", content: "one", metadata: { cliInput: true } }),
      msg({ id: "a1", role: "assistant", content: "ok" }),
      msg({ id: "u2", role: "user", content: "two", metadata: { cliInput: true } }),
    ]);
    expect(anchors.map((a) => ({ text: a.text, transcriptIndex: a.transcriptIndex }))).toEqual([
      { text: "one", transcriptIndex: 0 },
      { text: "two", transcriptIndex: 2 },
    ]);
    expect(anchors.every((a) => a.hasCodeChanges !== true)).toBe(true);
  });

  it("marks turns with Edit/Write as having code changes", () => {
    const anchors = rewindTurnsFromTranscript([
      msg({ id: "u1", role: "user", content: "hi", metadata: { cliInput: true } }),
      msg({ id: "a1", role: "assistant", content: "hello" }),
      msg({ id: "u2", role: "user", content: "edit file", metadata: { cliInput: true } }),
      msg({
        id: "a2",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t1",
            name: "Edit",
            input: {
              file_path: "/tmp/x.ts",
              old_string: "a",
              new_string: "b",
            },
          },
        ],
      }),
      msg({
        id: "r1",
        role: "tool",
        toolCallId: "t1",
        toolName: "Edit",
        content: "Replaced 1 occurrence in /tmp/x.ts",
      }),
    ]);
    expect(anchors[0]?.hasCodeChanges).toBe(false);
    expect(anchors[1]?.hasCodeChanges).toBe(true);
    expect(anchors[1]?.filesChanged?.count).toBe(1);
  });
});
