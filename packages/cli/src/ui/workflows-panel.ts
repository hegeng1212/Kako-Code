import { ansi, displayWidth, stripAnsi } from "./ansi.js";
import type { WorkflowRunRecord } from "@kako/core";
import type { AgentView, PhaseView } from "@kako/core";
import { wrapContentLines } from "./text-wrap.js";

export type WorkflowsPanelView = "list" | "detail" | "agent";

export interface WorkflowsPanelState {
  view: WorkflowsPanelView;
  runs: WorkflowRunRecord[];
  selectedIndex: number;
  selectedPhaseIndex: number;
  selectedAgentIndex: number;
  phases: PhaseView[];
  notice?: string;
}

const BOX_H = "─";
const BOX_V = "│";
const BOX_TL = "┌";
const BOX_TR = "┐";
const BOX_BL = "└";
const BOX_BR = "┘";
const BOX_T = "┬";
const BOX_B = "┴";

/** Display columns in `│ L │ R │` excluding the two cell contents. */
const SPLIT_ROW_OVERHEAD = 7;

function border(text: string): string {
  return `${ansi.planBorder}${text}${ansi.reset}`;
}

function splitColumnWidths(cols: number): { leftWidth: number; rightWidth: number } {
  const inner = Math.max(24, cols - SPLIT_ROW_OVERHEAD);
  const leftWidth = Math.min(28, Math.max(16, Math.floor(inner * 0.32)));
  const rightWidth = Math.max(8, inner - leftWidth);
  return { leftWidth, rightWidth };
}

function splitDataRow(
  left: string,
  right: string,
  leftWidth: number,
  rightWidth: number,
): string {
  const leftCell = padVisible(left, leftWidth);
  const rightCell = padVisible(right, rightWidth);
  return `${border(BOX_V)} ${leftCell} ${border(BOX_V)} ${rightCell} ${border(BOX_V)}`;
}

function splitTopRow(
  leftHeader: string,
  rightHeader: string,
  leftWidth: number,
  rightWidth: number,
): string {
  const leftDash = Math.max(0, leftWidth - displayWidth(leftHeader) - 2);
  const rightDash = Math.max(0, rightWidth - displayWidth(rightHeader) - 2);
  return `${border(BOX_TL)}${border(BOX_H)} ${leftHeader} ${border(BOX_H.repeat(leftDash))}${border(BOX_T)}${border(BOX_H)} ${rightHeader} ${border(BOX_H.repeat(rightDash))}${border(BOX_TR)}`;
}

function splitBottomRow(leftWidth: number, rightWidth: number): string {
  return `${border(BOX_BL)}${border(BOX_H.repeat(leftWidth + 2))}${border(BOX_B)}${border(BOX_H.repeat(rightWidth + 2))}${border(BOX_BR)}`;
}

export function sortWorkflowRuns(runs: WorkflowRunRecord[]): WorkflowRunRecord[] {
  return [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return sec > 0 ? `${sec}s` : "0s";
}

function runElapsed(run: WorkflowRunRecord): number {
  const start = new Date(run.startedAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  return end - start;
}

function padVisible(text: string, width: number): string {
  const w = displayWidth(text);
  if (w >= width) return fitLine(text, width);
  return text + " ".repeat(width - w);
}

function fitLine(text: string, cols: number): string {
  if (displayWidth(text) <= cols) return text;
  const plain = stripAnsi(text);
  let cut = plain.length;
  while (cut > 0 && displayWidth(plain.slice(0, cut) + "…") > cols) cut--;
  return plain.slice(0, cut) + "…";
}

function padRow(text: string, cols: number): string {
  const w = displayWidth(text);
  if (w === cols) return text;
  if (w < cols) return text + " ".repeat(cols - w);
  return fitLine(text, cols);
}

function alignRight(left: string, right: string, cols: number): string {
  const gap = Math.max(1, cols - displayWidth(left) - displayWidth(right));
  return padRow(left + " ".repeat(gap) + right, cols);
}

function formatPhaseLine(p: PhaseView, index: number, selected: boolean): string {
  const mark = selected ? `${ansi.text}>${ansi.reset} ` : "  ";
  const number = `${index + 1} `;
  const status =
    p.failed > 0
      ? `${ansi.red}✘${ansi.reset} `
      : p.done > 0 && p.total > 0 && p.done >= p.total
        ? `${ansi.green}✔${ansi.reset} `
        : "";
  const counts =
    p.total > 0 ? `${ansi.muted} ${p.done}/${p.total}${ansi.reset}` : "";
  return `${mark}${status}${number}${p.title}${counts}`;
}

function phaseStatusLabel(p: PhaseView): string {
  if (p.agents.length === 0) {
    return p.entered
      ? `${ansi.muted}Waiting for agents…${ansi.reset}`
      : `${ansi.muted}Not started yet${ansi.reset}`;
  }
  const running = p.agents.some((a) => a.status === "running");
  if (running) {
    return `${ansi.muted}${p.done}/${Math.max(p.total, p.agents.length)} agents running…${ansi.reset}`;
  }
  return "";
}

function agentPlainLine(agent: AgentView, selected: boolean): string {
  const mark = selected ? "> " : "  ";
  const icon =
    agent.status === "success" ? "✔" : agent.status === "error" ? "✘" : "…";
  const tok = agent.tokens != null ? ` · ${agent.tokens} tok` : "";
  const dur = agent.durationMs != null ? `  ${Math.round(agent.durationMs / 1000)}s` : "";
  const summary = agent.outputSummary ? ` — ${agent.outputSummary}` : "";
  return `${mark}${icon} ${agent.label}${tok}${dur}${summary}`;
}

function expandAgentWrapped(agent: AgentView, selected: boolean, width: number): string[] {
  const wrapped = wrapContentLines(agentPlainLine(agent, selected), width);
  if (!wrapped.length) return [formatAgentLine(agent, selected)];
  return wrapped.map((line, index) => {
    if (index === 0) return formatAgentLine(agent, selected);
    return `${ansi.muted}  ${line.trimStart()}${ansi.reset}`;
  });
}

function expandPhaseRightLines(
  phase: PhaseView,
  rightWidth: number,
  selectedAgentIndex: number,
): string[] {
  const lines: string[] = [];
  if (phase.detail) {
    for (const part of wrapContentLines(phase.detail, rightWidth)) {
      lines.push(`${ansi.muted}${part}${ansi.reset}`);
    }
  }
  for (const logLine of phase.logs) {
    for (const part of wrapContentLines(`· ${logLine}`, rightWidth)) {
      lines.push(`${ansi.muted}${part}${ansi.reset}`);
    }
  }
  if (phase.agents.length > 0) {
    phase.agents.forEach((agent, index) => {
      lines.push(...expandAgentWrapped(agent, index === selectedAgentIndex, rightWidth));
    });
  } else if (!phase.detail && phase.logs.length === 0) {
    const status = phaseStatusLabel(phase);
    if (status) lines.push(status);
  }
  return lines.length ? lines : [""];
}

function formatAgentLine(agent: AgentView, selected: boolean): string {
  const mark = selected ? `${ansi.text}>${ansi.reset} ` : "  ";
  const icon =
    agent.status === "success"
      ? `${ansi.green}✔${ansi.reset}`
      : agent.status === "error"
        ? `${ansi.red}✘${ansi.reset}`
        : `${ansi.yellow}…${ansi.reset}`;
  const tok = agent.tokens != null ? `${ansi.muted} · ${agent.tokens} tok${ansi.reset}` : "";
  const dur =
    agent.durationMs != null
      ? `${ansi.muted}  ${Math.round(agent.durationMs / 1000)}s${ansi.reset}`
      : "";
  const summary = agent.outputSummary
    ? `${ansi.muted} — ${agent.outputSummary}${ansi.reset}`
    : "";
  return `${mark}${icon} ${agent.label}${tok}${dur}${summary}`;
}

function runListDetail(run: WorkflowRunRecord): string {
  const elapsed = formatElapsed(runElapsed(run));
  if (run.status === "running" || run.status === "pending") {
    const phase = run.currentPhase ? ` · ${run.currentPhase}` : "";
    return `${run.agentsDone}/${run.agentsTotal || "?"} agents · ${elapsed}${phase}`;
  }
  if (run.error) {
    return `${elapsed} · ${run.status} · ${run.error.slice(0, 40)}`;
  }
  return `${elapsed} · ${run.status}`;
}

function runStatsLine(run: WorkflowRunRecord): string {
  const elapsed = formatElapsed(runElapsed(run));
  const statusLabel = run.error ? "error" : run.status;
  return `${run.agentsDone}/${run.agentsTotal || "?"} agents · ${elapsed} · ${statusLabel}`;
}

function renderListBody(state: WorkflowsPanelState, cols: number): string[] {
  const runs = sortWorkflowRuns(state.runs);
  const running = runs.filter((r) => r.status === "running" || r.status === "pending").length;
  const completed = runs.filter((r) => r.status === "completed").length;
  const summary =
    running > 0 ? `${running} running · ${completed} completed` : `${completed} completed`;

  const lines: string[] = [
    `${ansi.planBorder}Dynamic workflows${ansi.reset}`,
    `${ansi.muted}${summary}${ansi.reset}`,
    "",
  ];

  runs.forEach((run, i) => {
    const selected = i === state.selectedIndex;
    const prefix = selected ? `${ansi.text}❯${ansi.reset} ` : "  ";
    const icon =
      run.status === "running" || run.status === "pending"
        ? `${ansi.yellow}↻${ansi.reset}`
        : run.status === "error"
          ? `${ansi.red}✘${ansi.reset}`
          : run.status === "stopped"
            ? `${ansi.muted}■${ansi.reset}`
            : `${ansi.green}✔${ansi.reset}`;
    lines.push(
      `${prefix}${icon} ${run.name}  ${ansi.muted}${run.runId} · ${runListDetail(run)}${ansi.reset}`,
    );
  });

  if (runs.length === 0) {
    lines.push(`${ansi.muted}No dynamic workflow runs in this session yet.${ansi.reset}`);
  }
  if (state.notice) {
    lines.push("");
    lines.push(`${ansi.green}${state.notice}${ansi.reset}`);
  }
  return lines.map((line) => padRow(line, cols));
}

function renderDetailBody(state: WorkflowsPanelState, cols: number, bodyRows: number): string[] {
  const run = state.runs[state.selectedIndex];
  if (!run) return [padRow("No workflow selected", cols)];

  const phase = state.phases[state.selectedPhaseIndex];
  const { leftWidth, rightWidth } = splitColumnWidths(cols);

  const leftHeader = "Phases";
  const rightHeader = phase
    ? `${phase.title} · ${phase.agents.length} agents`
    : "No phase selected";

  const leftLines = state.phases.map((p, i) =>
    formatPhaseLine(p, i, i === state.selectedPhaseIndex),
  );
  const rightLines = phase
    ? expandPhaseRightLines(phase, rightWidth, state.selectedAgentIndex)
    : [""];

  const contentRows = Math.max(leftLines.length, rightLines.length, 1);
  const innerRows = Math.max(1, Math.min(bodyRows - 2, contentRows));

  const rows: string[] = [];
  rows.push(padRow(splitTopRow(leftHeader, rightHeader, leftWidth, rightWidth), cols));

  for (let i = 0; i < innerRows; i++) {
    rows.push(
      padRow(
        splitDataRow(leftLines[i] ?? "", rightLines[i] ?? "", leftWidth, rightWidth),
        cols,
      ),
    );
  }

  rows.push(padRow(splitBottomRow(leftWidth, rightWidth), cols));
  return rows;
}

function renderAgentBody(state: WorkflowsPanelState, cols: number): string[] {
  const run = state.runs[state.selectedIndex];
  const phase = state.phases[state.selectedPhaseIndex];
  const agent = phase?.agents[state.selectedAgentIndex];
  if (!run || !phase || !agent) return [padRow("No agent selected", cols)];

  const lines: string[] = [
    `${ansi.text}${agent.label}${ansi.reset}  ${ansi.muted}${phase.title} · ${run.runId}${ansi.reset}`,
    `${ansi.muted}status: ${agent.status}${agent.model ? ` · ${agent.model}` : ""}${agent.tokens != null ? ` · ${agent.tokens} tok` : ""}${agent.durationMs != null ? ` · ${Math.round(agent.durationMs / 1000)}s` : ""}${ansi.reset}`,
    "",
  ];
  if (agent.outputSummary) {
    lines.push(`${ansi.text}Summary${ansi.reset}`);
    for (const part of wrapContentLines(agent.outputSummary, cols)) {
      lines.push(part);
    }
  } else if (agent.status === "running") {
    lines.push(`${ansi.muted}Agent still running…${ansi.reset}`);
  } else {
    lines.push(`${ansi.muted}No output recorded.${ansi.reset}`);
  }
  if (state.notice) {
    lines.push("");
    lines.push(`${ansi.green}${state.notice}${ansi.reset}`);
  }
  return lines.map((line) => padRow(line, cols));
}

export function workflowsPanelFooterHints(state: WorkflowsPanelState): string {
  return footerHints(state);
}

function footerHints(state: WorkflowsPanelState): string {
  if (state.view === "agent") {
    return `${ansi.muted}esc back to phases${ansi.reset}`;
  }
  if (state.view === "detail") {
    const run = state.runs[state.selectedIndex];
    const running = run?.status === "running" || run?.status === "pending";
    const hints = ["↑/↓ select", "Tab agent", "Enter detail", "esc back", "s save"];
    if (running) hints.push("x stop");
    return `${ansi.muted}${hints.join(" · ")}${ansi.reset}`;
  }
  const running = state.runs.some((r) => r.status === "running" || r.status === "pending");
  const hints = ["↑/↓ to select", "Enter to view", "s to save", "Esc to close"];
  if (running) hints.splice(2, 0, "x to stop");
  return `${ansi.muted}${hints.join(" · ")}${ansi.reset}`;
}

/** Full-screen /workflows page (Claude Code-style dedicated view). */
export function renderWorkflowsFullScreen(
  state: WorkflowsPanelState,
  cols: number,
  rows: number,
): string[] {
  const screen = Array.from({ length: rows }, () => "");
  let row = 0;

  const set = (line: string) => {
    if (row < rows) screen[row] = padRow(line, cols);
    row++;
  };

  if (state.view === "list") {
    for (const line of renderListBody(state, cols)) {
      set(line);
    }
    while (row < rows - 1) set("");
    set(workflowsPanelFooterHints(state));
    return screen;
  }

  const run = state.runs[state.selectedIndex];
  if (run) {
    set(`\x1b[4m${ansi.text}${run.name}${ansi.reset}\x1b[24m`);
    const stats = `${ansi.muted}${runStatsLine(run)}${ansi.reset}`;
    const descLines = wrapContentLines(run.description, cols);
    if (descLines.length === 1) {
      const desc = `${ansi.muted}${descLines[0]}${ansi.reset}`;
      if (displayWidth(desc + stats) <= cols) {
        set(alignRight(desc, stats, cols));
      } else {
        set(desc);
        set(padRow(stats, cols));
      }
    } else {
      for (const part of descLines) {
        set(`${ansi.muted}${part}${ansi.reset}`);
      }
      set(padRow(stats, cols));
    }
    if (run.error) {
      for (const part of wrapContentLines(run.error, cols)) {
        set(`${ansi.red}${part}${ansi.reset}`);
      }
    }
    set("");
  }

  const footerRow = rows - 1;
  const bodyStart = row;
  const bodyRows = Math.max(3, footerRow - bodyStart - 1);

  const body =
    state.view === "agent"
      ? renderAgentBody(state, cols)
      : renderDetailBody(state, cols, bodyRows);

  for (const line of body) {
    if (row >= footerRow) break;
    set(line);
  }
  while (row < footerRow) set("");
  screen[footerRow] = padRow(workflowsPanelFooterHints(state), cols);
  return screen;
}

/** Legacy line list — used in tests; prefer renderWorkflowsFullScreen in layout. */
export function renderWorkflowsPanelLines(state: WorkflowsPanelState, cols: number): string[] {
  return renderWorkflowsFullScreen(state, cols, 40).filter((line) => line.trim().length > 0);
}
