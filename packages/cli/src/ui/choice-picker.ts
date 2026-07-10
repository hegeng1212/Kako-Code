import type { AskUserQuestionItem, AskUserQuestionOption } from "@kako/shared";
import { ansi, displayWidth, visibleLength } from "./ansi.js";
import { wrapContentLines } from "./text-wrap.js";

export const CHOICE_HINT = `${ansi.muted}Enter to select · ↑/↓ navigate · ←/→ switch topic · Esc to cancel${ansi.reset}`;

export const MULTI_SELECT_CHOICE_HINT = `${ansi.muted}Enter to toggle · ↑/↓ navigate · Enter on Submit to confirm · Esc to cancel${ansi.reset}`;

export type ChoiceRowKind = "option" | "custom" | "chat" | "submit";

export interface ChoiceRow {
  kind: ChoiceRowKind;
  label: string;
  description?: string;
  preview?: string;
  /** Original option index when kind === "option". */
  optionIndex?: number;
}

export function buildChoiceRows(
  options: AskUserQuestionOption[],
  allowCustom = true,
): ChoiceRow[] {
  const rows: ChoiceRow[] = options.map((opt, i) => ({
    kind: "option",
    label: opt.label,
    description: opt.description,
    preview: opt.preview,
    optionIndex: i,
  }));
  if (allowCustom) {
    rows.push({ kind: "custom", label: "Type something." });
    rows.push({ kind: "chat", label: "Chat about this" });
  }
  return rows;
}

/** Rows for single-question multi-select: options + Type something + Submit + Chat. */
export function buildMultiChoiceRows(options: AskUserQuestionOption[]): ChoiceRow[] {
  const rows: ChoiceRow[] = options.map((opt, i) => ({
    kind: "option",
    label: opt.label,
    description: opt.description,
    preview: opt.preview,
    optionIndex: i,
  }));
  rows.push({ kind: "custom", label: "Type something." });
  rows.push({ kind: "submit", label: "Submit" });
  rows.push({ kind: "chat", label: "Chat about this" });
  return rows;
}

function truncateToWidth(text: string, maxWidth: number): string {
  if (visibleLength(text) <= maxWidth) return text;
  let out = "";
  let width = 0;
  for (const ch of text) {
    const w = ch.codePointAt(0)! > 0xffff ? 2 : ch.charCodeAt(0) >= 0x1100 ? 2 : 1;
    if (width + w > maxWidth - 1) {
      return `${out}…`;
    }
    out += ch;
    width += w;
  }
  return out;
}

function renderOptionLines(
  row: ChoiceRow,
  index: number,
  selected: boolean,
  cols: number,
  multiSelect?: boolean,
  checked?: boolean,
): string[] {
  const prefix = selected ? `${ansi.accent}>${ansi.reset}` : " ";
  const num = `${index + 1}.`;
  const check =
    multiSelect && row.kind === "option"
      ? `${checked ? "[✔]" : "[ ]"} `
      : "";
  const head = `${prefix} ${check}${num} `;
  const desc =
    row.description && row.kind === "option"
      ? ` ${ansi.muted}${truncateToWidth(row.description, Math.max(20, cols - 8 - row.label.length))}${ansi.reset}`
      : "";
  const labelWidth = Math.max(12, cols - displayWidth(head) - displayWidth(desc));
  const wrapped = wrapContentLines(row.label, labelWidth);
  if (wrapped.length <= 1) {
    const label = `${ansi.text}${row.label}${ansi.reset}`;
    const body = `${head}${label}${desc}`;
    return [body.length > cols + 100 ? truncateToWidth(body, cols) : body];
  }
  const lines: string[] = [];
  const indent = " ".repeat(displayWidth(head));
  wrapped.forEach((part, i) => {
    const label = `${ansi.text}${part}${ansi.reset}`;
    if (i === 0) {
      lines.push(`${head}${label}${desc}`);
    } else {
      lines.push(`${indent}${label}`);
    }
  });
  return lines;
}

export interface RenderChoicePanelOptions {
  header: string;
  question: string;
  rows: ChoiceRow[];
  selectedIndex: number;
  cols: number;
  questionIndex?: number;
  questionTotal?: number;
  /** When false, omit the header chip row (shown after ↑/↓ in single-question mode). */
  showHeader?: boolean;
  /** Single-question multi-select: show checkboxes and use toggle semantics. */
  multiSelect?: boolean;
  /** Option indexes currently checked (multi-select only). */
  checkedOptionIndexes?: ReadonlySet<number>;
}

/** Lines to paint in the choice footer (excludes top/bottom separators and hint). */
export function renderChoicePanelLines(opts: RenderChoicePanelOptions): string[] {
  const {
    header,
    question,
    rows,
    selectedIndex,
    cols,
    questionIndex,
    questionTotal,
    showHeader = true,
    multiSelect = false,
    checkedOptionIndexes,
  } = opts;
  const lines: string[] = [];

  if (showHeader) {
    const chip = `${ansi.accent}${ansi.bold} ${header} ${ansi.reset}`;
    lines.push(truncateToWidth(chip, cols));
  }

  let q = question;
  if (multiSelect && !q.includes("multi-select") && !q.includes("可多选")) {
    q = `${q} ${ansi.muted}(multi-select)${ansi.reset}`;
  }
  if (questionTotal && questionTotal > 1 && questionIndex !== undefined) {
    q = `${question} ${ansi.muted}(${questionIndex + 1}/${questionTotal})${ansi.reset}`;
  }
  for (const part of wrapContentLines(q, cols)) {
    lines.push(`${ansi.text}${part}${ansi.reset}`);
  }

  lines.push("");

  rows.forEach((row, i) => {
    const checked =
      row.kind === "option" && row.optionIndex !== undefined
        ? checkedOptionIndexes?.has(row.optionIndex)
        : false;
    lines.push(
      ...renderOptionLines(row, i, i === selectedIndex, cols, multiSelect, checked),
    );
  });

  return lines;
}

export function choicePanelRowCount(opts: RenderChoicePanelOptions): number {
  return renderChoicePanelLines(opts).length + 3;
}

/** Chip bar for multi-question AskUserQuestion wizard (← ☒ Q1 ☐ Q2 ✔ Submit →). */
export function renderQuestionChipBar(
  questions: AskUserQuestionItem[],
  answers: Record<string, string>,
  focusIndex: number,
  cols: number,
): string {
  const parts: string[] = [`${ansi.muted}←${ansi.reset}`];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const answered = Boolean(answers[q.question]);
    const mark = answered ? "☒" : "☐";
    const label = `${mark} ${q.header}`;
    const styled =
      focusIndex === i
        ? `${ansi.accent}${ansi.bold}${label}${ansi.reset}`
        : `${ansi.muted}${label}${ansi.reset}`;
    parts.push(styled);
  }
  const allAnswered = questions.every((q) => answers[q.question]);
  const submitLabel = allAnswered ? "✔ Submit" : "Submit";
  const submitStyled =
    focusIndex === questions.length && allAnswered
      ? `${ansi.accent}${ansi.bold}${submitLabel}${ansi.reset}`
      : `${ansi.muted}${submitLabel}${ansi.reset}`;
  parts.push(submitStyled);
  parts.push(`${ansi.muted}→${ansi.reset}`);
  return truncateToWidth(parts.join("  "), cols);
}

/** Final confirmation rows after all wizard questions are answered. */
export function buildWizardReviewRows(): ChoiceRow[] {
  return [
    { kind: "submit", label: "Submit answers" },
    { kind: "chat", label: "Cancel" },
  ];
}

/** Review summary lines shown before final submit in the multi-question wizard. */
export function renderWizardReviewSummary(
  questions: AskUserQuestionItem[],
  answers: Record<string, string>,
  cols: number,
): string[] {
  const lines: string[] = [];
  lines.push(`${ansi.text}${ansi.bold}Review your answers${ansi.reset}`);
  lines.push("");

  questions.forEach((q, i) => {
    const answer = answers[q.question] ?? "";
    for (const part of wrapContentLines(`${i + 1}. ${q.question}`, cols)) {
      lines.push(`${ansi.text}${part}${ansi.reset}`);
    }
    for (const part of wrapContentLines(`   → ${answer}`, cols)) {
      lines.push(`${ansi.muted}${part}${ansi.reset}`);
    }
    lines.push("");
  });

  lines.push(`${ansi.text}Ready to submit your answers?${ansi.reset}`);
  return lines;
}

export interface RenderQuestionWizardPanelOptions {
  questions: AskUserQuestionItem[];
  answers: Record<string, string>;
  focusIndex: number;
  rows: ChoiceRow[];
  selectedIndex: number;
  cols: number;
}

export function renderQuestionWizardPanelLines(opts: RenderQuestionWizardPanelOptions): string[] {
  const { questions, answers, focusIndex, rows, selectedIndex, cols } = opts;
  const lines: string[] = [];
  lines.push(renderQuestionChipBar(questions, answers, focusIndex, cols));
  lines.push("");

  if (focusIndex >= questions.length) {
    const unanswered = questions.filter((q) => !answers[q.question]);
    if (unanswered.length === 0) {
      lines.push(...renderWizardReviewSummary(questions, answers, cols));
      lines.push("");
      rows.forEach((row, i) => {
        lines.push(...renderOptionLines(row, i, i === selectedIndex, cols));
      });
    } else {
      const pending = unanswered.map((q) => q.header).join(", ");
      lines.push(
        `${ansi.muted}Still need answers for: ${pending}. Use ←/→ to switch topics.${ansi.reset}`,
      );
    }
    return lines;
  }

  const item = questions[focusIndex]!;
  for (const part of wrapContentLines(item.question, cols)) {
    lines.push(`${ansi.text}${part}${ansi.reset}`);
  }
  lines.push("");
  rows.forEach((row, i) => {
    lines.push(...renderOptionLines(row, i, i === selectedIndex, cols));
  });
  return lines;
}

export function questionWizardPanelRowCount(opts: RenderQuestionWizardPanelOptions): number {
  return renderQuestionWizardPanelLines(opts).length + 3;
}

export function padChoiceLine(line: string, cols: number): string {
  const len = visibleLength(line);
  if (len >= cols) return line;
  return line + " ".repeat(cols - len);
}

/** Parse stdin for choice navigation (true arrow keys). */
export function parseChoiceInputActions(data: string): {
  actions: Array<
    | { type: "up" }
    | { type: "down" }
    | { type: "left" }
    | { type: "right" }
    | { type: "enter" }
    | { type: "escape" }
    | { type: "interrupt" }
  >;
} {
  const actions: Array<
    | { type: "up" }
    | { type: "down" }
    | { type: "left" }
    | { type: "right" }
    | { type: "enter" }
    | { type: "escape" }
    | { type: "interrupt" }
  > = [];
  let i = 0;

  while (i < data.length) {
    const ch = data[i]!;
    if (ch === "\r" || ch === "\n") {
      actions.push({ type: "enter" });
      i++;
      continue;
    }
    if (ch === "\u0003") {
      actions.push({ type: "interrupt" });
      i++;
      continue;
    }
    if (ch === "\x1b") {
      const rest = data.slice(i);
      const csi = rest.match(/^\x1b\[([0-9;]*)([~A-Za-z])/);
      if (csi) {
        const code = csi[2];
      if (code === "A") actions.push({ type: "up" });
      else if (code === "B") actions.push({ type: "down" });
      else if (code === "C") actions.push({ type: "right" });
      else if (code === "D") actions.push({ type: "left" });
      else if (code === "Z") actions.push({ type: "up" });
        i += csi[0].length;
        continue;
      }
      if (rest.length === 1 || (rest.length > 1 && rest[1] !== "[")) {
        actions.push({ type: "escape" });
        i += 1;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }

  return { actions };
}
