import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@kako/shared";
import {
  askUserQuestionHandler,
  askUserQuestionToolDefinition,
  formatAskUserQuestionResult,
  parseAskUserQuestionInput,
} from "./ask-user-question.js";

const execContext: ToolExecutionContext = {
  agentId: "agent-main",
  sessionId: "sess-1",
  toolUseId: "tu-1",
  cwd: "/tmp",
};

const validQuestion = {
  question: "Which library should we use?",
  header: "Library",
  multiSelect: false,
  options: [
    { label: "date-fns", description: "Tree-shakeable" },
    { label: "dayjs", description: "Small API" },
  ],
};

describe("AskUserQuestion tool definition", () => {
  it("matches Claude Code / Cursor AskUserQuestion description and schema", () => {
    expect(askUserQuestionToolDefinition.name).toBe("AskUserQuestion");
    expect(askUserQuestionToolDefinition.description).toContain("blocked on a decision");
    expect(askUserQuestionToolDefinition.description).toContain('select "Other"');
    expect(askUserQuestionToolDefinition.description).toContain("multiSelect: true");
    expect(askUserQuestionToolDefinition.description).toContain("(Recommended)");
    expect(askUserQuestionToolDefinition.description).toContain("Plan mode note");
    expect(askUserQuestionToolDefinition.description).toContain("EnterPlanMode");
    expect(askUserQuestionToolDefinition.description).toContain("ExitPlanMode");
    expect(askUserQuestionToolDefinition.description).toContain("Preview feature");
    expect(askUserQuestionToolDefinition.description).toContain(
      "previews are only supported for single-select questions",
    );
    expect(askUserQuestionToolDefinition.description).not.toContain("MCP");
    expect(askUserQuestionToolDefinition.description).not.toContain("matching Skill");

    const schema = askUserQuestionToolDefinition.inputSchema;
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["questions"]);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
      ["annotations", "answers", "metadata", "questions"].sort(),
    );

    const questions = schema.properties!.questions!;
    expect(questions.type).toBe("array");
    expect(questions.minItems).toBe(1);
    expect(questions.maxItems).toBe(4);
    expect(questions.items?.required).toEqual(["question", "header", "options", "multiSelect"]);
    expect(Object.keys(questions.items?.properties ?? {}).sort()).toEqual(
      ["header", "multiSelect", "options", "question"].sort(),
    );

    const options = questions.items!.properties!.options!;
    expect(options.minItems).toBe(2);
    expect(options.maxItems).toBe(4);
    expect(options.items?.required).toEqual(["label", "description"]);
    expect(Object.keys(options.items?.properties ?? {}).sort()).toEqual(
      ["description", "label", "preview"].sort(),
    );

    expect(schema.properties!.annotations?.propertyNames).toEqual({ type: "string" });
    expect(schema.properties!.answers?.propertyNames).toEqual({ type: "string" });
    expect(schema.properties!.metadata?.properties?.source?.type).toBe("string");
    expect(questions.items?.properties?.multiSelect?.default).toBe(false);
  });
});

describe("parseAskUserQuestionInput", () => {
  it("accepts valid single question", () => {
    const parsed = parseAskUserQuestionInput({ questions: [validQuestion] });
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0]!.header).toBe("Library");
  });

  it("ignores harness-only answers and annotations fields", () => {
    const parsed = parseAskUserQuestionInput({
      questions: [validQuestion],
      answers: { "Which library should we use?": "date-fns" },
      annotations: { "Which library should we use?": { notes: "prefer small bundle" } },
    });
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.metadata).toBeUndefined();
  });

  it("accepts metadata.source", () => {
    const parsed = parseAskUserQuestionInput({
      questions: [validQuestion],
      metadata: { source: "remember" },
    });
    expect(parsed.metadata?.source).toBe("remember");
  });

  it("rejects empty questions array", () => {
    expect(() => parseAskUserQuestionInput({ questions: [] })).toThrow(/1-4 questions/);
  });

  it("rejects too many questions", () => {
    const five = Array.from({ length: 5 }, () => validQuestion);
    expect(() => parseAskUserQuestionInput({ questions: five })).toThrow(/1-4 questions/);
  });

  it("rejects header longer than 12 chars", () => {
    expect(() =>
      parseAskUserQuestionInput({
        questions: [{ ...validQuestion, header: "VeryLongHeader" }],
      }),
    ).toThrow(/12 characters/);
  });

  it("rejects fewer than 2 options", () => {
    expect(() =>
      parseAskUserQuestionInput({
        questions: [
          {
            ...validQuestion,
            options: [{ label: "only", description: "one" }],
          },
        ],
      }),
    ).toThrow(/2-4 options/);
  });

  it("rejects preview on multiSelect question", () => {
    expect(() =>
      parseAskUserQuestionInput({
        questions: [
          {
            ...validQuestion,
            multiSelect: true,
            options: [
              { label: "a", description: "A", preview: "mockup" },
              { label: "b", description: "B" },
            ],
          },
        ],
      }),
    ).toThrow(/single-select/);
  });
});

describe("askUserQuestionHandler", () => {
  it("returns Claude-style answer summary from prompt host", async () => {
    const askUserQuestion = vi.fn(async () => ({
      answers: { "Which library should we use?": "date-fns" },
    }));

    const output = await askUserQuestionHandler(
      { questions: [validQuestion] },
      { ...execContext, askUserQuestion },
    );

    expect(askUserQuestion).toHaveBeenCalledTimes(1);
    expect(String(output)).toContain("Your questions have been answered");
    expect(String(output)).toContain('"Which library should we use?"="date-fns"');
  });

  it("fails when no interactive prompt is configured", async () => {
    await expect(
      askUserQuestionHandler({ questions: [validQuestion] }, execContext),
    ).rejects.toThrow(/not available/);
  });
});

describe("formatAskUserQuestionResult", () => {
  it("formats answered questions for the model", () => {
    const text = formatAskUserQuestionResult({
      answers: { "Q?": "A" },
    });
    expect(text).toContain("Your questions have been answered");
    expect(text).toContain('"Q?"="A"');
    expect(text).toContain("You can now continue with these answers in mind.");
  });

  it("serializes declined state for model consumption", () => {
    const json = formatAskUserQuestionResult({ answers: {}, declined: true });
    const parsed = JSON.parse(json) as { declined: boolean; message: string };
    expect(parsed.declined).toBe(true);
    expect(parsed.message).toContain("cancelled");
  });

  it("formats partial answers when user dismisses mid-wizard", () => {
    const text = formatAskUserQuestionResult({
      answers: { "Q1?": "A1" },
      declined: true,
    });
    expect(text).toContain("Partial answers");
    expect(text).toContain('"Q1?"="A1"');
    expect(text).not.toContain('"declined": true');
  });
});
