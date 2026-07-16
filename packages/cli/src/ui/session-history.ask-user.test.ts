import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@kako/shared";
import { chatTurnsFromTranscript, parseAskUserQuestionAnswers } from "./session-history.js";

function msg(partial: Partial<TranscriptMessage> & Pick<TranscriptMessage, "role" | "content">): TranscriptMessage {
  return {
    id: partial.id ?? `m-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: partial.timestamp ?? "2026-07-14T00:00:00.000Z",
    ...partial,
  };
}

describe("parseAskUserQuestionAnswers", () => {
  it("parses answered pairs", () => {
    expect(
      parseAskUserQuestionAnswers(
        'Your questions have been answered: "关注点"="Option A", "受众"="投资者".',
      ),
    ).toEqual({
      关注点: "Option A",
      受众: "投资者",
    });
  });
});

describe("chatTurnsFromTranscript AskUserQuestion", () => {
  it("rebuilds AskUserQuestion as a choice-group, not a bare tool row", () => {
    const turns = chatTurnsFromTranscript([
      msg({
        id: "u1",
        role: "user",
        content: "/deep-research write Option A report",
        metadata: { cliInput: true },
      }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "q1",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  header: "Focus",
                  question: "报告的主要关注点是什么？",
                  options: [{ label: "Option A", description: "a" }],
                },
                {
                  header: "Audience",
                  question: "目标受众是谁？",
                  options: [{ label: "投资者", description: "b" }],
                },
              ],
            },
          },
        ],
      }),
      msg({
        id: "tr1",
        role: "tool",
        content:
          'Your questions have been answered: "报告的主要关注点是什么？"="规模与趋势", "目标受众是谁？"="投资者".',
        toolCallId: "q1",
        toolName: "AskUserQuestion",
      }),
      msg({ id: "a2", role: "assistant", content: "继续研究" }),
    ]);

    expect(turns).toHaveLength(1);
    const types = turns[0]!.timeline.map((e) => e.type);
    expect(types).toContain("choice-group");
    expect(types).not.toContain("tool");
    const group = turns[0]!.timeline.find((e) => e.type === "choice-group");
    expect(group).toMatchObject({
      type: "choice-group",
      items: [
        {
          question: "报告的主要关注点是什么？",
          answer: "规模与趋势",
        },
        {
          question: "目标受众是谁？",
          answer: "投资者",
        },
      ],
    });
  });

  it("does not list bare questions while AskUserQuestion is still awaiting answers", () => {
    const turns = chatTurnsFromTranscript([
      msg({
        id: "u1",
        role: "user",
        content: "/deep-research 写一份母婴行业报告",
        metadata: { cliInput: true },
      }),
      msg({
        id: "a1",
        role: "assistant",
        content: "为了让报告更有针对性，我需要先确认几个问题。",
        toolCalls: [
          {
            id: "q-pending",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  header: "受众",
                  question: "这份母婴行业报告的主要受众是谁？",
                  options: [{ label: "投资者", description: "a" }],
                },
                {
                  header: "区域",
                  question: "报告的重点区域是？",
                  options: [{ label: "中国大陆", description: "b" }],
                },
              ],
            },
          },
        ],
      }),
    ]);

    expect(turns).toHaveLength(1);
    const types = turns[0]!.timeline.map((e) => e.type);
    expect(types).not.toContain("choice-group");
    expect(types).not.toContain("choice");
    expect(types).not.toContain("tool");
    expect(turns[0]!.timeline.some((e) => e.type === "answer")).toBe(true);
  });
});
