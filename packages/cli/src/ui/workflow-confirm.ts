import type { WorkflowMeta } from "@kako/core";
import { ansi } from "./ansi.js";
import type { ChoiceRow } from "./choice-picker.js";
import { padChoiceLine, renderChoicePanelLines } from "./choice-picker.js";
import { renderScriptCodeBlock } from "./script-code-view.js";
import { wrapContentLines } from "./text-wrap.js";

export const WORKFLOW_CONFIRM_TITLE = "Run a dynamic workflow?";

export const WORKFLOW_CONFIRM_RISK_WARNING =
  "Dynamic workflows can use a lot of tokens quickly by running many subagents in parallel — which counts against your usage limit. Stop a running workflow at any time with /workflows, or disable dynamic workflows in /config.";

export const WORKFLOW_CONFIRM_HINT = `${ansi.muted}Enter to select · ↑/↓ navigate · Esc to cancel${ansi.reset}`;

export interface WorkflowConfirmDecision {
  action: "run" | "cancel";
  scriptPath?: string;
}

export interface WorkflowConfirmViewState {
  scriptVisible: boolean;
  scriptToggled: boolean;
  selectedIndex: number;
}

export function buildWorkflowConfirmChoiceRows(state: WorkflowConfirmViewState): ChoiceRow[] {
  const scriptLabel = state.scriptVisible ? "View workflow summary" : "View raw script";
  const scriptSuffix = state.scriptToggled ? " ✔" : "";
  return [
    {
      kind: "option",
      label: "Yes, run it",
      optionIndex: 0,
    },
    {
      kind: "option",
      label: `${scriptLabel}${scriptSuffix}`,
      optionIndex: 1,
    },
    {
      kind: "option",
      label: "No",
      optionIndex: 2,
    },
  ];
}

export function workflowConfirmDecisionFromRow(
  row: ChoiceRow,
  scriptPath: string,
): WorkflowConfirmDecision {
  if (row.kind === "option" && row.optionIndex === 0) {
    return { action: "run", scriptPath };
  }
  return { action: "cancel" };
}

function formatArgs(args: unknown): string {
  if (args === undefined || args === null || args === "") return "(none)";
  if (typeof args === "string") return args.trim() || "(none)";
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

export function renderWorkflowPhaseSummary(meta: WorkflowMeta): string[] {
  if (!meta.phases?.length) return [];
  const intro =
    "This workflow spins up multiple subagents across " +
    `${meta.phases.length} phase${meta.phases.length === 1 ? "" : "s"}:`;
  const lines = [intro];
  meta.phases.forEach((phase, index) => {
    const detail = phase.detail ? `: ${phase.detail}` : "";
    lines.push(`${index + 1}. ${phase.title}${detail}`);
  });
  return lines;
}

export function renderWorkflowConfirmContentLines(opts: {
  meta: WorkflowMeta;
  args: unknown;
  scriptSource: string;
  scriptVisible: boolean;
  cols: number;
}): string[] {
  const lines: string[] = [];
  lines.push(`${ansi.bold}${WORKFLOW_CONFIRM_TITLE}${ansi.reset}`);
  lines.push("");

  for (const part of wrapContentLines(opts.meta.description, opts.cols)) {
    lines.push(`${ansi.text}${part}${ansi.reset}`);
  }
  lines.push("");

  if (opts.scriptVisible) {
    lines.push(...renderScriptCodeBlock(opts.scriptSource, opts.cols));
    lines.push("");
  } else {
    for (const part of renderWorkflowPhaseSummary(opts.meta)) {
      for (const wrapped of wrapContentLines(part, opts.cols)) {
        lines.push(`${ansi.text}${wrapped}${ansi.reset}`);
      }
    }
    lines.push("");
  }

  for (const part of wrapContentLines(`args: ${formatArgs(opts.args)}`, opts.cols)) {
    lines.push(`${ansi.muted}${part}${ansi.reset}`);
  }
  lines.push("");
  for (const part of wrapContentLines(WORKFLOW_CONFIRM_RISK_WARNING, opts.cols)) {
    lines.push(`${ansi.yellow}${part}${ansi.reset}`);
  }

  return lines;
}

export function workflowConfirmEditorHint(scriptPath: string, cols: number): string {
  const editor = process.env.EDITOR?.trim() || "$EDITOR";
  const pathHint = scriptPath.length > cols - 30 ? "…" + scriptPath.slice(-Math.max(20, cols - 30)) : scriptPath;
  return `${ansi.muted}ctrl+g to edit script in ${editor} · ${pathHint}${ansi.reset}`;
}

export function workflowConfirmPanelRowCount(
  cols: number,
  state: WorkflowConfirmViewState,
): number {
  const rows = buildWorkflowConfirmChoiceRows(state);
  const panel = renderChoicePanelLines({
    header: "",
    question: "",
    rows,
    selectedIndex: state.selectedIndex,
    cols,
    showHeader: false,
  });
  return 1 + panel.length + 1 + 1 + 1;
}

export function renderWorkflowConfirmPanelLines(opts: {
  state: WorkflowConfirmViewState;
  scriptPath: string;
  cols: number;
}): string[] {
  const rows = buildWorkflowConfirmChoiceRows(opts.state);
  const panel = renderChoicePanelLines({
    header: "",
    question: "",
    rows,
    selectedIndex: opts.state.selectedIndex,
    cols: opts.cols,
    showHeader: false,
  });
  return [...panel, workflowConfirmEditorHint(opts.scriptPath, opts.cols)];
}

export function padWorkflowConfirmLines(lines: string[], cols: number): string[] {
  return lines.map((line) => padChoiceLine(line, cols));
}

/** Optional context lines shown above the workflow tool row while waiting for approval. */
export function renderWorkflowConfirmContextLines(meta: WorkflowMeta, args: unknown): string[] {
  const lines = [`${ansi.muted}Args: ${formatArgs(args)}${ansi.reset}`];
  if (meta.phases?.length) {
    for (const phase of meta.phases) {
      lines.push(
        `${ansi.muted}  · ${phase.title}${phase.detail ? ` — ${phase.detail}` : ""}${ansi.reset}`,
      );
    }
  }
  return lines;
}

export function workflowConfirmToggleScript(state: WorkflowConfirmViewState): WorkflowConfirmViewState {
  return {
    ...state,
    scriptVisible: !state.scriptVisible,
    scriptToggled: true,
  };
}

export function workflowConfirmOptionIndexFromRow(row: ChoiceRow): number | undefined {
  return row.kind === "option" ? row.optionIndex : undefined;
}
