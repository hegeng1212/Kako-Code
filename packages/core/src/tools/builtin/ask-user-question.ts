import type {
  AskUserQuestionInput,
  AskUserQuestionItem,
  AskUserQuestionOption,
  AskUserQuestionResult,
  ToolDefinition,
  ToolHandler,
} from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_ASK_USER_QUESTION_DESCRIPTION } from "../claude-tool-text.js";

const ASK_USER_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_ASK_USER_QUESTION_DESCRIPTION);

export const askUserQuestionToolDefinition: ToolDefinition = {
  name: "AskUserQuestion",
  description: ASK_USER_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      annotations: {
        type: "object",
        description:
          "Optional per-question annotations from the user (e.g., notes on preview selections). Keyed by question text.",
        propertyNames: { type: "string" },
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          properties: {
            notes: {
              type: "string",
              description: "Free-text notes the user added to their selection.",
            },
            preview: {
              type: "string",
              description:
                "The preview content of the selected option, if the question used previews.",
            },
          },
        },
      },
      answers: {
        type: "object",
        description: "User answers collected by the permission component",
        propertyNames: { type: "string" },
        additionalProperties: { type: "string" },
      },
      metadata: {
        type: "object",
        additionalProperties: false,
        description: "Optional metadata for tracking and analytics purposes. Not displayed to user.",
        properties: {
          source: {
            type: "string",
            description:
              'Optional identifier for the source of this question (e.g., "remember" for /remember command). Used for analytics tracking.',
          },
        },
      },
      questions: {
        type: "array",
        description: "Questions to ask the user (1-4 questions)",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            header: {
              type: "string",
              description:
                'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".',
            },
            multiSelect: {
              type: "boolean",
              default: false,
              description:
                "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
            },
            options: {
              type: "array",
              description:
                "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically.",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  description: {
                    type: "string",
                    description:
                      "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
                  },
                  label: {
                    type: "string",
                    description:
                      "The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.",
                  },
                  preview: {
                    type: "string",
                    description:
                      "Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format.",
                  },
                },
                required: ["label", "description"],
              },
            },
            question: {
              type: "string",
              description:
                'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
            },
          },
          required: ["question", "header", "options", "multiSelect"],
        },
      },
    },
    required: ["questions"],
  },
};

function parseOption(raw: unknown, index: number): AskUserQuestionOption {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Question option ${index + 1} must be an object`);
  }
  const o = raw as Record<string, unknown>;
  const label = String(o.label ?? "").trim();
  const description = String(o.description ?? "").trim();
  if (!label) throw new Error(`Question option ${index + 1} requires label`);
  if (!description) throw new Error(`Question option ${index + 1} requires description`);
  const preview = o.preview !== undefined ? String(o.preview) : undefined;
  return preview !== undefined ? { label, description, preview } : { label, description };
}

function parseQuestion(raw: unknown, index: number): AskUserQuestionItem {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Question ${index + 1} must be an object`);
  }
  const q = raw as Record<string, unknown>;
  const question = String(q.question ?? "").trim();
  const header = String(q.header ?? "").trim();
  if (!question) throw new Error(`Question ${index + 1} requires question text`);
  if (!header) throw new Error(`Question ${index + 1} requires header`);
  if (header.length > 12) {
    throw new Error(`Question ${index + 1} header must be at most 12 characters`);
  }

  const multiSelect = Boolean(q.multiSelect);
  if (!Array.isArray(q.options)) {
    throw new Error(`Question ${index + 1} requires options array`);
  }
  if (q.options.length < 2 || q.options.length > 4) {
    throw new Error(`Question ${index + 1} must have 2-4 options`);
  }

  const options = q.options.map((opt, i) => {
    const parsed = parseOption(opt, i);
    if (multiSelect && parsed.preview) {
      throw new Error("Preview options are only supported for single-select questions");
    }
    return parsed;
  });

  if (!multiSelect && options.some((o) => o.preview)) {
    // single-select with preview — allowed
  }

  return { question, header, options, multiSelect };
}

/** Validate and normalize model tool input before prompting the user. */
export function parseAskUserQuestionInput(raw: Record<string, unknown>): AskUserQuestionInput {
  if (!Array.isArray(raw.questions)) {
    throw new Error("AskUserQuestion requires questions array");
  }
  if (raw.questions.length < 1 || raw.questions.length > 4) {
    throw new Error("AskUserQuestion supports 1-4 questions");
  }

  const questions = raw.questions.map((q, i) => parseQuestion(q, i));

  const metadata =
    raw.metadata && typeof raw.metadata === "object"
      ? { source: (raw.metadata as { source?: string }).source }
      : undefined;

  return { questions, metadata };
}

export function formatAskUserQuestionResult(result: AskUserQuestionResult): string {
  const answers = result.answers ?? {};
  const answerPairs = Object.entries(answers).map(([question, answer]) => `"${question}"="${answer}"`);

  if (result.declined) {
    if (answerPairs.length > 0) {
      return (
        `User dismissed the choice picker before finishing all questions. ` +
        `Partial answers: ${answerPairs.join(", ")}. ` +
        `Use these answers and continue — do not say the user skipped everything.`
      );
    }
    return JSON.stringify(
      {
        declined: true,
        answers: {},
        message:
          "User cancelled the choice picker (Esc) without selecting any options. Stop this turn and wait for a new user message — do not call AskUserQuestion again or continue answering.",
      },
      null,
      2,
    );
  }

  if (answerPairs.length === 0) {
    return JSON.stringify(
      {
        declined: true,
        answers: {},
        message: "No answers were collected.",
      },
      null,
      2,
    );
  }

  return `Your questions have been answered: ${answerPairs.join(", ")}. Continue based on these answers.`;
}

export const askUserQuestionHandler: ToolHandler = async (input, context) => {
  if (!context.askUserQuestion) {
    throw new Error("AskUserQuestion is not available in this environment (no interactive prompt)");
  }

  const parsed = parseAskUserQuestionInput(input);
  const result = await context.askUserQuestion(parsed);
  return formatAskUserQuestionResult(result);
};
