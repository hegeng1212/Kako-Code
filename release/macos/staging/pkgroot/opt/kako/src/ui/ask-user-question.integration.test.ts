import { describe, expect, it, vi } from "vitest";
import type { AskUserQuestionInput, ChoiceRow } from "@kako/shared";
import { stripAnsi } from "./ansi.js";
import { createAskUserQuestionPrompt } from "./ask-user-question.js";
import { CHOICE_HINT, buildChoiceRows, renderChoicePanelLines, renderQuestionChipBar } from "./choice-picker.js";
import { ChoiceCancelledError, ExitRequestedError } from "./terminal-layout.js";

const sampleChoiceQuestion: AskUserQuestionInput = {
  questions: [
    {
      question: "Which option should we use?",
      header: "Choice",
      multiSelect: false,
      options: [
        { label: "Option A", description: "First path" },
        { label: "Option B", description: "Second path" },
        { label: "Option C", description: "Third path" },
      ],
    },
  ],
};

type MockLayout = {
  content: string[];
  turnTimeline: string[];
  choices: Array<{ item: AskUserQuestionInput["questions"][number]; answer: string; declined?: boolean }>;
  choiceGroups: Array<Array<{ item: AskUserQuestionInput["questions"][number]; answer: string; declined?: boolean }>>;
  appendContent: (text: string) => void;
  appendTurnTimeline: (text: string) => void;
  appendChoiceResult: (
    item: AskUserQuestionInput["questions"][number],
    answer: string,
    opts?: { declined?: boolean },
  ) => void;
  appendChoiceGroupResult: (
    items: Array<{
      item: AskUserQuestionInput["questions"][number];
      answer: string;
      declined?: boolean;
    }>,
  ) => void;
  readChoice: ReturnType<typeof vi.fn>;
  readQuestionWizard: ReturnType<typeof vi.fn>;
  readLine: ReturnType<typeof vi.fn>;
};

function createMockLayout(handlers: {
  readChoice?: () => Promise<ChoiceRow>;
  readQuestionWizard?: () => Promise<{ answers: Record<string, string>; declined?: boolean }>;
  readLine?: () => Promise<string>;
}): MockLayout {
  const layout: MockLayout = {
    content: [],
    turnTimeline: [],
    choices: [],
    choiceGroups: [],
    appendContent(text: string) {
      layout.content.push(text);
    },
    appendTurnTimeline(text: string) {
      layout.turnTimeline.push(text);
    },
    appendChoiceResult(item, answer, opts) {
      layout.choices.push({ item, answer, declined: opts?.declined });
    },
    appendChoiceGroupResult(items) {
      layout.choiceGroups.push(items);
    },
    readChoice: vi.fn(handlers.readChoice ?? (async () => ({ kind: "option", label: "Option A" }))),
    readQuestionWizard: vi.fn(
      handlers.readQuestionWizard ??
        (async () => ({
          answers: { "Which option should we use?": "Option A" },
        })),
    ),
    readLine: vi.fn(handlers.readLine ?? (async () => "")),
  };
  return layout;
}

describe("AskUserQuestion CLI integration", () => {
  const input: AskUserQuestionInput = sampleChoiceQuestion;

  it("shows choice panel copy (header, question, options, hint)", () => {
    const q = input.questions[0]!;
    const lines = renderChoicePanelLines({
      header: q.header,
      question: q.question,
      rows: buildChoiceRows(q.options),
      selectedIndex: 0,
      cols: 100,
    });
    const plain = stripAnsi(lines.join("\n"));
    expect(plain).toContain("Choice");
    expect(plain).toContain("Which option should we use?");
    expect(plain).toContain("Option A");
    expect(plain).toContain("Type something.");
    expect(plain).toContain("Chat about this");
    expect(stripAnsi(CHOICE_HINT)).toContain("Enter to select");
    expect(stripAnsi(CHOICE_HINT)).toContain("Esc to cancel");
  });

  it("select option → answered summary in chat", async () => {
    const layout = createMockLayout({
      readChoice: async () => ({
        kind: "option",
        label: "Option A",
        description: "First path",
        optionIndex: 0,
      }),
    });

    const prompt = createAskUserQuestionPrompt(layout as never);
    const result = await prompt(input);

    expect(result.declined).toBeUndefined();
    expect(result.answers["Which option should we use?"]).toBe("Option A");
    expect(layout.choices).toHaveLength(1);
    expect(layout.choices[0]!.answer).toBe("Option A");
    expect(layout.readChoice).toHaveBeenCalledTimes(1);
  });

  it("Esc → declined summary in chat (Claude-style)", async () => {
    const layout = createMockLayout({
      readChoice: async () => {
        throw new ChoiceCancelledError();
      },
    });

    const prompt = createAskUserQuestionPrompt(layout as never);
    const result = await prompt(input);

    expect(result.declined).toBe(true);
    expect(result.answers).toEqual({});
    expect(layout.choices).toHaveLength(1);
    expect(layout.choices[0]!.declined).toBe(true);
  });

  it("multi-question wizard collects all answers", async () => {
    const multiInput: AskUserQuestionInput = {
      questions: [
        {
          question: "First question?",
          header: "Topic1",
          multiSelect: false,
          options: [
            { label: "A1", description: "First" },
            { label: "A2", description: "Second" },
          ],
        },
        {
          question: "Second question?",
          header: "Topic2",
          multiSelect: false,
          options: [
            { label: "B1", description: "First" },
            { label: "B2", description: "Second" },
          ],
        },
      ],
    };

    const layout = createMockLayout({
      readQuestionWizard: async () => ({
        answers: {
          "First question?": "A1",
          "Second question?": "B2",
        },
      }),
    });

    const prompt = createAskUserQuestionPrompt(layout as never);
    const result = await prompt(multiInput);

    expect(result.answers).toEqual({
      "First question?": "A1",
      "Second question?": "B2",
    });
    expect(layout.readQuestionWizard).toHaveBeenCalledTimes(1);
    expect(layout.readChoice).not.toHaveBeenCalled();
    expect(layout.choiceGroups).toHaveLength(1);
    expect(layout.choiceGroups[0]).toHaveLength(2);
    expect(layout.choices).toHaveLength(0);
  });

  it("renders question chip bar for wizard", () => {
    const bar = stripAnsi(
      renderQuestionChipBar(
        [
          { question: "Q1", header: "Topic1", multiSelect: false, options: [] },
          { question: "Q2", header: "Topic2", multiSelect: false, options: [] },
        ],
        0,
        [true, false],
      ),
    );
    expect(bar).toContain("Topic1");
    expect(bar).toContain("☐ Topic2");
  });

  it("exit during choice propagates ExitRequestedError", async () => {
    const layout = createMockLayout({
      readChoice: async () => {
        throw new ExitRequestedError();
      },
    });

    const prompt = createAskUserQuestionPrompt(layout as never);
    await expect(prompt(input)).rejects.toBeInstanceOf(ExitRequestedError);
  });

  it("multi-select single question uses checkbox picker", async () => {
    const multiInput: AskUserQuestionInput = {
      questions: [
        {
          question: "Which features do you need?",
          header: "Features",
          multiSelect: true,
          options: [
            { label: "Memory", description: "Multi-turn context" },
            { label: "Search", description: "Web search" },
            { label: "Tools", description: "Plugin calls" },
          ],
        },
      ],
    };

    const layout = createMockLayout({
      readChoice: vi.fn(async () => ({ kind: "submit", label: "Memory, Search" })),
    });

    const prompt = createAskUserQuestionPrompt(layout as never);
    const result = await prompt(multiInput);

    expect(result.answers["Which features do you need?"]).toBe("Memory, Search");
    expect(layout.readChoice).toHaveBeenCalledWith(
      expect.objectContaining({ multiSelect: true }),
    );
    expect(layout.choices[0]!.answer).toBe("Memory, Search");
  });
});
