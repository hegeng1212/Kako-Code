import { describe, expect, it } from "vitest";
import type { AskUserQuestionItem } from "@kako/shared";
import {
  renderAskUserQuestionAnswered,
  renderAskUserQuestionDeclined,
  renderAskUserQuestionDeclinedItem,
  renderAskUserQuestionPrompt,
  renderAskUserQuestionSelection,
  renderChoiceGroupHeaderLine,
  renderChoiceGroupLines,
  renderChoiceSummaryLine,
} from "./ask-user-question-display.js";
import { stripAnsi } from "./ansi.js";

const sampleQuestion: AskUserQuestionItem = {
  question: "Which option should we use?",
  header: "Choice",
  multiSelect: false,
  options: [
    { label: "Option A", description: "First path" },
    { label: "Option B", description: "Second path" },
  ],
};

describe("ask-user-question display", () => {
  it("renders cancelled picker (Esc)", () => {
    const text = stripAnsi(renderAskUserQuestionDeclinedItem(sampleQuestion));
    expect(text).toContain("已取消选择");
    expect(text).toContain("Which option should we use?");
  });

  it("renders declined summary", () => {
    const text = stripAnsi(renderAskUserQuestionDeclined([sampleQuestion]));
    expect(text).toContain("User declined to answer questions");
    expect(text).toContain("Which option should we use?");
  });

  it("renders inline prompt and selection", () => {
    const prompt = stripAnsi(renderAskUserQuestionPrompt(sampleQuestion, 0, 1));
    expect(prompt).toContain("[Choice]");
    expect(prompt).toContain("Which option should we use?");
    expect(prompt).toContain("Option A");

    const selection = stripAnsi(renderAskUserQuestionSelection(sampleQuestion, "Option B"));
    expect(selection).toContain("→ Option B");
  });

  it("renders legacy answered summary", () => {
    const text = stripAnsi(
      renderAskUserQuestionAnswered([sampleQuestion], {
        "Which option should we use?": "Option A",
      }),
    );
    expect(text).toContain("User answered Kako's questions");
    expect(text).toContain("→ Option A");
  });

  it("renders multi-question group in Claude Code style", () => {
    const lines = renderChoiceGroupLines([
      { question: "您想开发什么类型的AI功能？", answer: "对话聊天机器人" },
      { question: "您倾向使用什么技术栈来开发？", answer: "Python后端" },
    ]);
    const text = stripAnsi(lines.join("\n"));
    expect(text).toContain("⏺");
    expect(text).toContain("User answered Kako's questions");
    expect(text).toContain("· 您想开发什么类型的AI功能？ → 对话聊天机器人");
    expect(text).toContain("· 您倾向使用什么技术栈来开发？ → Python后端");
    expect(renderChoiceGroupHeaderLine()).toContain("⏺");
  });

  it("omits unanswered rows from choice group lines", () => {
    expect(
      renderChoiceGroupLines([
        { question: "尚未作答的问题？", answer: "" },
        { question: "空答案", answer: "   " },
      ]),
    ).toEqual([]);
  });

  it("renders collapsible choice summary", () => {
    const collapsed = stripAnsi(
      renderChoiceSummaryLine(
        { ...sampleQuestion, answer: "Option B" },
        false,
      ),
    );
    expect(collapsed).toContain("[Choice]");
    expect(collapsed).toContain("→ Option B");
    expect(collapsed).toContain("click to expand");
    expect(collapsed).not.toContain("Option A");

    const expanded = stripAnsi(
      renderChoiceSummaryLine(
        { ...sampleQuestion, answer: "Option B", declined: true },
        true,
      ),
    );
    expect(expanded).toContain("已取消选择");
    expect(expanded).toContain("click to collapse");
  });
});
