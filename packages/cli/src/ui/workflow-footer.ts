import { ansi } from "./ansi.js";
import { formatDurationMs } from "./format-duration.js";

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
  const maxContent = Math.max(24, cols - 4);
  const line = truncate(content, maxContent);
  return `${ansi.planBorder}◉${ansi.reset} ${ansi.muted}${line}${ansi.reset}`;
}

export function renderWorkflowWaitingLine(count: number): string {
  const label =
    count === 1
      ? "Waiting for 1 dynamic workflow to finish"
      : `Waiting for ${count} dynamic workflows to finish`;
  return `${ansi.text}*${ansi.reset} ${ansi.muted}${label}${ansi.reset}`;
}
