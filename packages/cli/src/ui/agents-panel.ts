import { ansi } from "./ansi.js";
import type { BackgroundTask } from "@kako/core";
import { formatDurationMs } from "./format-duration.js";

export type AgentsPanelView = "list" | "detail";

export interface AgentsPanelState {
  view: AgentsPanelView;
  selectedIndex: number;
  tasks: BackgroundTask[];
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function taskLabel(task: BackgroundTask): string {
  return task.description?.trim() || task.subagentName?.trim() || task.id;
}

function taskStatus(task: BackgroundTask): string {
  return task.stopped ? "stopped" : "running";
}

export function createAgentsPanelState(tasks: BackgroundTask[]): AgentsPanelState {
  return {
    view: "list",
    selectedIndex: 0,
    tasks,
  };
}

export function renderAgentsPanelHeader(cols: number): string {
  const title = "Background agents";
  const pad = Math.max(0, cols - title.length - 2);
  return `${ansi.planBorder}◉${ansi.reset} ${ansi.text}${title}${ansi.reset}${" ".repeat(pad)}`;
}

export function renderAgentsPanelBody(state: AgentsPanelState, cols: number, bodyRows: number): string[] {
  const lines: string[] = [];
  if (!state.tasks.length) {
    lines.push(`${ansi.muted}Waiting for agents…${ansi.reset}`);
    while (lines.length < bodyRows) lines.push("");
    return lines.slice(0, bodyRows);
  }

  if (state.view === "list") {
    for (let i = 0; i < state.tasks.length; i++) {
      const task = state.tasks[i]!;
      const selected = i === state.selectedIndex;
      const elapsed = formatDurationMs(Date.now() - new Date(task.startedAt).getTime());
      const prefix = selected ? `${ansi.green}›${ansi.reset} ` : "  ";
      const label = truncate(taskLabel(task), Math.max(20, cols - 24));
      lines.push(
        `${prefix}${ansi.text}${label}${ansi.reset} ${ansi.muted}· ${taskStatus(task)} · ${elapsed}${ansi.reset}`,
      );
    }
  } else {
    const task = state.tasks[state.selectedIndex];
    if (task) {
      lines.push(`${ansi.text}${taskLabel(task)}${ansi.reset}`);
      lines.push(`${ansi.muted}Subagent: ${task.subagentName ?? "—"}${ansi.reset}`);
      lines.push(`${ansi.muted}Task ID: ${task.id}${ansi.reset}`);
      if (task.childSessionId) {
        lines.push(`${ansi.muted}Session: ${task.childSessionId}${ansi.reset}`);
      }
      lines.push(`${ansi.muted}Status: ${taskStatus(task)}${ansi.reset}`);
    }
  }

  while (lines.length < bodyRows) lines.push("");
  return lines.slice(0, bodyRows);
}

export function renderAgentsPanelFooter(): string {
  return `${ansi.muted}←/Esc back · ↑↓ navigate · Enter detail${ansi.reset}`;
}
