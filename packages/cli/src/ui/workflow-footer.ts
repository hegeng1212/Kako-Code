import { ansi } from "./ansi.js";
import { formatDurationMs } from "./format-duration.js";
import { FOOTER_HINT_INDENT } from "./input-footer.js";

export interface WorkflowFooterState {
  name: string;
  description: string;
  agentsDone: number;
  agentsTotal: number;
  agentsFailed: number;
  elapsedMs: number;
  status: "running" | "pending";
  currentPhase?: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function renderWorkflowFooterLine(state: WorkflowFooterState, cols: number): string {
  const phase = state.currentPhase ? ` · ${state.currentPhase}` : "";
  const stats = `${state.agentsDone}/${state.agentsTotal} agents · ${formatDurationMs(state.elapsedMs)}${phase}`;
  const content = `${state.name} · ${stats}`;
  const maxContent = Math.max(24, cols - 4 - FOOTER_HINT_INDENT.length);
  const line = truncate(content, maxContent);
  return `${FOOTER_HINT_INDENT}${ansi.planBorder}◉${ansi.reset} ${ansi.muted}${line}${ansi.reset}`;
}

/** One footer row per live workflow in the current session. */
export function renderWorkflowFooterLines(states: WorkflowFooterState[], cols: number): string[] {
  return states
    .filter((s) => s.status === "running" || s.status === "pending")
    .map((s) => renderWorkflowFooterLine(s, cols));
}

export function renderWorkflowWaitingLine(count: number): string {
  const label =
    count === 1
      ? "Waiting for 1 dynamic workflow to finish..."
      : `Waiting for ${count} dynamic workflows to finish...`;
  return `${FOOTER_HINT_INDENT}${ansi.text}*${ansi.reset} ${ansi.muted}${label}${ansi.reset}`;
}

export function renderBackgroundAgentWaitingLine(count: number): string {
  const label =
    count === 1
      ? "Waiting for 1 background agent to finish..."
      : `Waiting for ${count} background agents to finish...`;
  return `${FOOTER_HINT_INDENT}${ansi.text}*${ansi.reset} ${ansi.muted}${label}${ansi.reset}`;
}
