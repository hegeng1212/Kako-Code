import type { AskUserQuestionItem, AskUserQuestionOption } from "@kako/shared";
import { ansi, displayWidth, visibleLength } from "./ansi.js";
import { wrapContentLines } from "./text-wrap.js";

export const CHOICE_HINT = `${ansi.muted}Enter to select · ↑/↓ navigate · ←/→ switch topic · Esc to cancel${ansi.reset}`;

export const MULTI_SELECT_CHOICE_HINT = `${ansi.muted}Enter to select · Tab/Arrow keys to navigate · Esc to cancel${ansi.reset}`;

export const WIZARD_MULTI_SELECT_HINT = `${ansi.muted}Enter to select · Tab/Arrow keys · ←/→ switch topic · Esc to cancel${ansi.reset}`;

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

/** Rows for multi-select: options with [ ] checkboxes + Type something + Submit + Chat. */
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

/** Restore checked option indexes from a prior multi-select answer string. */
export function checkedIndexesFromAnswer(
  options: AskUserQuestionOption[],
  answer: string | undefined,
): Set<number> {
  const checked = new Set<number>();
  if (!answer?.trim()) return checked;
  const labels = answer
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const label of labels) {
    const idx = options.findIndex((o) => o.label === label);
    if (idx >= 0) checked.add(idx);
  }
  return checked;
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
  displayNumber: number | null,
  selected: boolean,
  cols: number,
  multiSelect?: boolean,
  checked?: boolean,
  customText?: string,
): string[] {
  const prefix = selected ? `${ansi.accent}>${ansi.reset}` : " ";

  if (row.kind === "submit") {
    const label = `${ansi.text}${row.label}${ansi.reset}`;
    return [`${prefix} ${label}`];
  }

  const num = displayNumber != null ? `${displayNumber}.` : "";
  const check =
    multiSelect && (row.kind === "option" || row.kind === "custom")
      ? `${checked ? "[✓]" : "[ ]"} `
      : "";
  const head = `${prefix} ${num ? `${num} ` : ""}${check}`;

  if (row.kind === "custom" && multiSelect) {
    const typed = customText ?? "";
    // Armed/editing: hide "Type something." — show typed text + caret only.
    // Unchecked: restore the placeholder label.
    if (!checked) {
      return [`${head}${ansi.text}${row.label}${ansi.reset}`];
    }
    const cursor = selected ? `${ansi.accent}▌${ansi.reset}` : "";
    return [`${head}${ansi.text}${typed}${ansi.reset}${cursor}`];
  }

  const label = `${ansi.text}${row.label}${ansi.reset}`;
  if (row.kind === "option" && row.description) {
    const indent = " ".repeat(Math.max(2, displayWidth(head)));
    const descLines = wrapContentLines(row.description, Math.max(20, cols - indent.length));
    return [
      `${head}${label}`,
      ...descLines.map((d) => `${indent}${ansi.muted}${d}${ansi.reset}`),
    ];
  }

  const labelWidth = Math.max(12, cols - displayWidth(head));
  const wrapped = wrapContentLines(row.label, labelWidth);
  if (wrapped.length <= 1) {
    return [`${head}${label}`];
  }
  const lines: string[] = [];
  const indent = " ".repeat(displayWidth(head));
  wrapped.forEach((part, i) => {
    const piece = `${ansi.text}${part}${ansi.reset}`;
    if (i === 0) lines.push(`${head}${piece}`);
    else lines.push(`${indent}${piece}`);
  });
  return lines;
}

/** Join checked option labels with optional custom text (parallel semantics). */
export function composeMultiSelectAnswer(
  options: AskUserQuestionOption[],
  checkedOptionIndexes: ReadonlySet<number>,
  customText?: string,
): string {
  const labels = [...checkedOptionIndexes]
    .sort((a, b) => a - b)
    .map((i) => options[i]?.label)
    .filter((l): l is string => Boolean(l?.trim()));
  const custom = customText?.trim();
  if (custom) labels.push(custom);
  return labels.join(", ");
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
  /** Inline custom text for Type something (multi-select). */
  customText?: string;
  /** Explicit check state for Type something (Enter/Space arms; empty leave clears). */
  customChecked?: boolean;
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
  customText = "",
  customChecked = false,
} = opts;
  const lines: string[] = [];

  if (showHeader) {
    const chip = `${ansi.accent}${ansi.bold} ${header} ${ansi.reset}`;
    lines.push(truncateToWidth(chip, cols));
  }

  let q = question;
  if (multiSelect && !q.includes("multi-select") && !q.includes("可多选")) {
    q = `${q} ${ansi.muted}(可多选)${ansi.reset}`;
  }
  if (questionTotal && questionTotal > 1 && questionIndex !== undefined) {
    q = `${question} ${ansi.muted}(${questionIndex + 1}/${questionTotal})${ansi.reset}`;
  }
  for (const part of wrapContentLines(q, cols)) {
    lines.push(`${ansi.text}${part}${ansi.reset}`);
  }

  lines.push("");

  let displayNumber = 0;
  rows.forEach((row, i) => {
    if (multiSelect && row.kind === "chat") {
      const sepLen = Math.min(cols, 48);
      lines.push(`${ansi.muted}${"─".repeat(sepLen)}${ansi.reset}`);
    }
    const numbered = row.kind === "option" || row.kind === "custom" || row.kind === "chat";
    if (numbered) displayNumber += 1;
    const checked =
      row.kind === "option" && row.optionIndex !== undefined
        ? checkedOptionIndexes?.has(row.optionIndex) === true
        : row.kind === "custom"
          ? customChecked
          : false;
    lines.push(
      ...renderOptionLines(
        row,
        numbered ? displayNumber : null,
        i === selectedIndex,
        cols,
        multiSelect,
        checked,
        row.kind === "custom" ? customText : undefined,
      ),
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
  /** When focusing a multiSelect question, render option checkboxes. */
  multiSelect?: boolean;
  checkedOptionIndexes?: ReadonlySet<number>;
  customText?: string;
  customChecked?: boolean;
}

export function renderQuestionWizardPanelLines(opts: RenderQuestionWizardPanelOptions): string[] {
  const {
    questions,
    answers,
    focusIndex,
    rows,
    selectedIndex,
    cols,
    multiSelect = false,
    checkedOptionIndexes,
    customText = "",
    customChecked = false,
  } = opts;
  const lines: string[] = [];
  lines.push(renderQuestionChipBar(questions, answers, focusIndex, cols));
  lines.push("");

  if (focusIndex >= questions.length) {
    const unanswered = questions.filter((q) => !answers[q.question]);
    if (unanswered.length === 0) {
      lines.push(...renderWizardReviewSummary(questions, answers, cols));
      lines.push("");
      let displayNumber = 0;
      rows.forEach((row, i) => {
        const numbered = row.kind === "option" || row.kind === "custom" || row.kind === "chat";
        if (numbered) displayNumber += 1;
        lines.push(
          ...renderOptionLines(row, numbered ? displayNumber : null, i === selectedIndex, cols),
        );
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
  let questionText = item.question;
  if (multiSelect && !questionText.includes("multi-select") && !questionText.includes("可多选")) {
    questionText = `${questionText} ${ansi.muted}(可多选)${ansi.reset}`;
  }
  for (const part of wrapContentLines(questionText, cols)) {
    lines.push(`${ansi.text}${part}${ansi.reset}`);
  }
  lines.push("");
  let displayNumber = 0;
  rows.forEach((row, i) => {
    if (multiSelect && row.kind === "chat") {
      const sepLen = Math.min(cols, 48);
      lines.push(`${ansi.muted}${"─".repeat(sepLen)}${ansi.reset}`);
    }
    const numbered = row.kind === "option" || row.kind === "custom" || row.kind === "chat";
    if (numbered) displayNumber += 1;
    const checked =
      row.kind === "option" && row.optionIndex !== undefined
        ? checkedOptionIndexes?.has(row.optionIndex) === true
        : row.kind === "custom"
          ? customChecked
          : false;
    lines.push(
      ...renderOptionLines(
        row,
        numbered ? displayNumber : null,
        i === selectedIndex,
        cols,
        multiSelect,
        checked,
        row.kind === "custom" ? customText : undefined,
      ),
    );
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
    | { type: "space" }
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
    | { type: "space" }
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
    if (ch === " ") {
      actions.push({ type: "space" });
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
