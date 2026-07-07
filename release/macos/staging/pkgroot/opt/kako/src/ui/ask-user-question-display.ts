import type { AskUserQuestionItem, AskUserQuestionOption } from "@kako/shared";
import { ansi } from "./ansi.js";

export interface ChoiceGroupAnswerItem {
  question: string;
  answer: string;
  declined?: boolean;
}

/** Question + options shown in chat before the user picks (legacy / tests). */
export function renderAskUserQuestionPrompt(
  item: AskUserQuestionItem,
  questionIndex: number,
  questionTotal: number,
): string {
  const lines = [
    `${ansi.accent}[${item.header}]${ansi.reset} ${ansi.text}${item.question}${ansi.reset}`,
    `${ansi.muted}(${questionIndex + 1}/${questionTotal}${item.multiSelect ? " · multi-select" : ""})${ansi.reset}`,
  ];

  if (item.multiSelect) {
    lines.push("");
    for (let i = 0; i < item.options.length; i++) {
      const opt = item.options[i]!;
      lines.push(renderChoiceOptionLine(opt, i, true));
    }
    lines.push(`${ansi.muted}Enter numbers separated by commas (e.g. 1,3)${ansi.reset}`);
  } else {
    for (const opt of item.options) {
      lines.push(renderChoiceOptionLine(opt));
    }
  }

  return lines.join("\n");
}

/** Collapsed summary row for a completed choice (click to expand options). */
export function renderChoiceSummaryLine(
  item: Pick<AskUserQuestionItem, "header" | "question" | "options" | "multiSelect"> & {
    answer: string;
    declined?: boolean;
  },
  expanded: boolean,
): string {
  const chevron = expanded ? "▾" : "▸";
  const hint = expanded
    ? `${ansi.muted}(click to collapse)${ansi.reset}`
    : `${ansi.muted}(click to expand)${ansi.reset}`;
  const answerPart = item.declined ? `(已取消选择)` : item.answer;
  return `${ansi.accent}[${item.header}]${ansi.reset} ${ansi.muted}${chevron}${ansi.reset} ${ansi.text}${item.question}${ansi.reset} ${ansi.muted}→ ${answerPart}${ansi.reset} ${hint}`;
}

/** One option line inside an expanded choice block. */
export function renderChoiceOptionLine(
  opt: AskUserQuestionOption,
  index?: number,
  multiSelect?: boolean,
): string {
  if (multiSelect && index !== undefined) {
    return `  ${ansi.muted}${index + 1}.${ansi.reset} ${ansi.text}${opt.label}${ansi.reset} — ${ansi.muted}${opt.description}${ansi.reset}`;
  }
  return `  ${ansi.muted}·${ansi.reset} ${ansi.text}${opt.label}${ansi.reset} — ${ansi.muted}${opt.description}${ansi.reset}`;
}

export function isChoiceToggleLine(meta?: { kind?: string }): boolean {
  return meta?.kind === "choice-toggle";
}

/** Header for a multi-question answer block (Claude Code-style). */
export function renderChoiceGroupHeaderLine(): string {
  return `${ansi.green}⏺${ansi.reset} ${ansi.text}User answered Kako's questions:${ansi.reset}`;
}

/** One question → answer row inside a choice group. */
export function renderChoiceGroupAnswerLine(
  item: ChoiceGroupAnswerItem,
  treePrefix: string,
): string {
  const answerText = item.declined ? "(skipped)" : item.answer;
  return `${ansi.muted}${treePrefix}${ansi.reset} ${ansi.muted}·${ansi.reset} ${ansi.text}${item.question}${ansi.reset} ${ansi.muted}→${ansi.reset} ${ansi.text}${answerText}${ansi.reset}`;
}

/** Full multi-question answer block for the transcript. */
export function renderChoiceGroupLines(items: ChoiceGroupAnswerItem[]): string[] {
  if (items.length === 0) return [];
  const lines = [renderChoiceGroupHeaderLine()];
  items.forEach((item, index) => {
    const isLast = index === items.length - 1;
    const treePrefix = isLast ? "└" : "│";
    lines.push(renderChoiceGroupAnswerLine(item, treePrefix));
  });
  return lines;
}

/** User's selection recorded inline in the conversation. */
export function renderAskUserQuestionSelection(
  item: AskUserQuestionItem,
  answer: string,
): string {
  return `  ${ansi.muted}└ ${item.question} → ${answer}${ansi.reset}`;
}

/** User pressed Esc on the choice menu — cancelled picker only, not a declined answer. */
export function renderAskUserQuestionDeclinedItem(item: AskUserQuestionItem): string {
  return `  ${ansi.muted}└ ${item.question} → (已取消选择)${ansi.reset}`;
}

/** @deprecated Use renderChoiceGroupLines for multi-question wizard. */
export function renderAskUserQuestionDeclined(questions: AskUserQuestionItem[]): string {
  const lines = [`  ${ansi.muted}● User declined to answer questions${ansi.reset}`];
  for (const q of questions) {
    lines.push(renderAskUserQuestionDeclinedItem(q));
  }
  return lines.join("\n");
}

/** @deprecated Use renderChoiceGroupLines for multi-question wizard. */
export function renderAskUserQuestionAnswered(
  questions: AskUserQuestionItem[],
  answers: Record<string, string>,
): string {
  return renderChoiceGroupLines(
    questions.map((q) => ({
      question: q.question,
      answer: answers[q.question] ?? "",
    })),
  ).join("\n");
}
