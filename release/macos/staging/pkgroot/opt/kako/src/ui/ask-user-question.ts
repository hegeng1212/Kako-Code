import type {
  AskUserQuestionInput,
  AskUserQuestionItem,
  AskUserQuestionPrompt,
  AskUserQuestionResult,
} from "@kako/shared";
import { buildChoiceRows, buildMultiChoiceRows } from "./choice-picker.js";
import { ChoiceCancelledError, ExitRequestedError, type ChatLayout } from "./terminal-layout.js";

function appendWizardChoices(
  layout: ChatLayout,
  questions: AskUserQuestionItem[],
  result: AskUserQuestionResult,
): void {
  const answered = new Set(Object.keys(result.answers));
  const rows: Array<{ item: AskUserQuestionItem; answer: string; declined?: boolean }> = [];

  for (const item of questions) {
    const answer = result.answers[item.question];
    if (answer) {
      rows.push({ item, answer });
    } else if (result.declined) {
      rows.push({ item, answer: "", declined: true });
    }
  }

  if (rows.length > 0) {
    layout.appendChoiceGroupResult(rows);
  }

  if (result.declined && answered.size > 0 && answered.size < questions.length) {
    layout.appendTurnTimeline("  (部分题目已作答，其余已取消)");
  }
}

async function promptOne(
  layout: ChatLayout,
  item: AskUserQuestionItem,
  index: number,
  total: number,
): Promise<{ answer: string; preview?: string }> {
  if (item.multiSelect) {
    const rows = buildMultiChoiceRows(item.options);
    const selected = await layout.readChoice({
      header: item.header,
      question: item.question,
      rows,
      questionIndex: index,
      questionTotal: total,
      multiSelect: true,
    });

    if (selected.kind === "chat") {
      throw new ChoiceCancelledError();
    }

    if (selected.kind === "custom" || selected.kind === "submit") {
      const answer = selected.label.trim();
      if (!answer) throw new Error("No valid selections");
      layout.appendChoiceResult(item, answer);
      return { answer };
    }

    throw new Error("Unexpected multi-select choice row");
  }

  const rows = buildChoiceRows(item.options, true);
  const selected = await layout.readChoice({
    header: item.header,
    question: item.question,
    rows,
    questionIndex: index,
    questionTotal: total,
  });

  if (selected.kind === "chat") {
    throw new ChoiceCancelledError();
  }

  if (selected.kind === "custom") {
    const custom = (await layout.readLine({ plain: true })).trim();
    if (!custom) throw new Error("Empty answer");
    layout.appendChoiceResult(item, custom);
    return { answer: custom };
  }

  layout.appendChoiceResult(item, selected.label);
  return { answer: selected.label, preview: selected.preview };
}

/** Build an interactive AskUserQuestion prompt backed by the chat TUI. */
export function createAskUserQuestionPrompt(layout: ChatLayout): AskUserQuestionPrompt {
  return async (input: AskUserQuestionInput): Promise<AskUserQuestionResult> => {
    if (input.questions.length > 1) {
      try {
        const result = await layout.readQuestionWizard(input.questions);
        appendWizardChoices(layout, input.questions, result);
        return result;
      } catch (err) {
        if (err instanceof ExitRequestedError) throw err;
        if (err instanceof ChoiceCancelledError) {
          return { answers: {}, declined: true };
        }
        throw err;
      }
    }

    const answers: Record<string, string> = {};
    const annotations: AskUserQuestionResult["annotations"] = {};

    for (let i = 0; i < input.questions.length; i++) {
      const item = input.questions[i]!;
      try {
        const { answer, preview } = await promptOne(layout, item, i, input.questions.length);
        answers[item.question] = answer;
        if (preview) {
          annotations[item.question] = { preview };
        }
      } catch (err) {
        if (err instanceof ExitRequestedError) {
          throw err;
        }
        if (err instanceof ChoiceCancelledError) {
          layout.appendChoiceResult(item, "", { declined: true });
          return { answers, declined: true };
        }
        throw err;
      }
    }

    return {
      answers,
      ...(Object.keys(annotations).length ? { annotations } : {}),
    };
  };
}
