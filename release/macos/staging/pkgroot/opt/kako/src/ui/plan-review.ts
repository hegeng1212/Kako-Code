import { homedir } from "node:os";
import { ansi } from "./ansi.js";
import type { ChoiceRow } from "./choice-picker.js";
import { padChoiceLine, renderChoicePanelLines } from "./choice-picker.js";

export const PLAN_REVIEW_INTRO = [
  `${ansi.bold}Ready to code?${ansi.reset}`,
  "",
  `${ansi.text}Here is Kako's plan:${ansi.reset}`,
  "",
] as const;

export const PLAN_REVIEW_QUESTION =
  "Kako has written up a plan and is ready to execute. Would you like to proceed?";

export const PLAN_REVIEW_HINT = `${ansi.muted}Enter to select · ↑/↓ navigate · ctrl+g to edit in VS Code · Esc to cancel${ansi.reset}`;

export type PlanReviewAction = "auto" | "manual" | "revise";

export interface PlanReviewDecision {
  action: PlanReviewAction | "cancel";
  feedback?: string;
}

export function buildPlanReviewRows(): ChoiceRow[] {
  return [
    { kind: "option", label: "Yes, and use auto mode", optionIndex: 0 },
    { kind: "option", label: "Yes, manually approve edits", optionIndex: 1 },
    { kind: "option", label: "Tell Kako what to change", optionIndex: 2 },
  ];
}

export function planActionFromRow(row: ChoiceRow): PlanReviewAction | null {
  if (row.kind !== "option" || row.optionIndex === undefined) return null;
  if (row.optionIndex === 0) return "auto";
  if (row.optionIndex === 1) return "manual";
  if (row.optionIndex === 2) return "revise";
  return null;
}

export function formatPlanPathForDisplay(planPath: string): string {
  const home = homedir();
  if (planPath.startsWith(home)) {
    return `~${planPath.slice(home.length)}`;
  }
  return planPath;
}

export function planReviewFooterLine(planPath: string, cols: number): string {
  const displayPath = formatPlanPathForDisplay(planPath);
  const hint = `${ansi.muted}ctrl+g to edit in VS Code · ${displayPath}${ansi.reset}`;
  if (hint.length <= cols + 50) return hint;
  const trimmed = `${ansi.muted}ctrl+g to edit · ${displayPath}${ansi.reset}`;
  return trimmed.length <= cols + 50 ? trimmed : displayPath;
}

export function planReviewPanelRowCount(cols: number): number {
  const rows = buildPlanReviewRows();
  const panel = renderChoicePanelLines({
    header: "",
    question: PLAN_REVIEW_QUESTION,
    rows,
    selectedIndex: 0,
    cols,
    showHeader: false,
  });
  // top sep + panel + bottom sep + hint + path line
  return 1 + panel.length + 1 + 1 + 1;
}

export function renderPlanReviewPanelLines(opts: {
  selectedIndex: number;
  cols: number;
  planPath: string;
}): string[] {
  const rows = buildPlanReviewRows();
  const panel = renderChoicePanelLines({
    header: "",
    question: PLAN_REVIEW_QUESTION,
    rows,
    selectedIndex: opts.selectedIndex,
    cols: opts.cols,
    showHeader: false,
  });
  return [...panel, planReviewFooterLine(opts.planPath, opts.cols)];
}

export function padPlanReviewLines(lines: string[], cols: number): string[] {
  return lines.map((line) => padChoiceLine(line, cols));
}
