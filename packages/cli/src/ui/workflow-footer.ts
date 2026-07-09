import { ansi } from "./ansi.js";

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

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function renderWorkflowFooterLine(state: WorkflowFooterState, cols: number): string {
  const phase = state.currentPhase ? ` · ${state.currentPhase}` : "";
  const stats = `${state.agentsDone}/${state.agentsTotal} agents · ${formatElapsed(state.elapsedMs)}${phase}`;
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
