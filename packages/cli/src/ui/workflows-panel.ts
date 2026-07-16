import { ansi, displayWidth, stripAnsi } from "./ansi.js";
import { formatDurationMs, formatDurationSeconds } from "./format-duration.js";
import type { WorkflowRunRecord } from "@kako/core";
import type { AgentView, PhaseView } from "@kako/core";
import { isPhaseFatal, isPhaseSuccessful } from "@kako/core";
import { wrapContentLines } from "./text-wrap.js";

export type WorkflowsPanelView = "list" | "detail" | "agent";
/** Which pane has keyboard focus in the detail (phase list) view. */
export type WorkflowsDetailFocus = "phase" | "agent";

export interface WorkflowsPanelState {
  view: WorkflowsPanelView;
  runs: WorkflowRunRecord[];
  selectedIndex: number;
  selectedPhaseIndex: number;
  selectedAgentIndex: number;
  phases: PhaseView[];
  /** Focus within the detail split view — phase list (left) or agent list (right). */
  detailFocus: WorkflowsDetailFocus;
  /** Scroll offset (lines) for the agent detail pane on the right in agent view. */
  agentDetailScroll: number;
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

function agentSplitColumnWidths(cols: number): { leftWidth: number; rightWidth: number } {
  const inner = Math.max(24, cols - SPLIT_ROW_OVERHEAD);
  const leftWidth = Math.min(24, Math.max(14, Math.floor(inner * 0.28)));
  const rightWidth = Math.max(12, inner - leftWidth);
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
  const leftDash = Math.max(0, leftWidth - displayWidth(leftHeader) - 1);
  const rightDash = Math.max(0, rightWidth - displayWidth(rightHeader) - 1);
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

/** How long terminal (non-running) workflow runs stay visible in `/workflows`. */
export const WORKFLOW_PANEL_RETENTION_MS = 24 * 60 * 60 * 1000;

export function isLiveWorkflowStatus(status: WorkflowRunRecord["status"]): boolean {
  return status === "running" || status === "pending";
}

function workflowRunActivityAtMs(run: WorkflowRunRecord): number {
  const iso = run.completedAt ?? run.startedAt;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Panel list: always show live runs; keep other statuses only within the
 * retention window (default 24h) so old completed work does not pile up.
 */
export function filterWorkflowRunsForPanel(
  runs: WorkflowRunRecord[],
  now = Date.now(),
  retentionMs = WORKFLOW_PANEL_RETENTION_MS,
): WorkflowRunRecord[] {
  const cutoff = now - retentionMs;
  return runs.filter((run) => {
    if (isLiveWorkflowStatus(run.status)) return true;
    return workflowRunActivityAtMs(run) >= cutoff;
  });
}

/** Filter + newest-first sort for the `/workflows` panel. */
export function prepareWorkflowRunsForPanel(
  runs: WorkflowRunRecord[],
  now = Date.now(),
): WorkflowRunRecord[] {
  return sortWorkflowRuns(filterWorkflowRunsForPanel(runs, now));
}

function runElapsed(run: WorkflowRunRecord): number {
  const start = new Date(run.startedAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  return end - start;
}

function padVisible(text: string, width: number): string {
  let cell = text;
  if (displayWidth(cell) > width) {
    cell = fitLine(cell, width);
    while (displayWidth(cell) > width && stripAnsi(cell).length > 0) {
      cell = cell.slice(0, -1);
    }
    if (displayWidth(cell) + 1 <= width && stripAnsi(cell).length > 0) {
      cell += "…";
    }
  }
  const deficit = width - displayWidth(cell);
  if (deficit > 0) {
    cell += " ".repeat(deficit);
  }
  return cell;
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

function alignRightInCell(left: string, right: string, width: number): string {
  const gap = Math.max(1, width - displayWidth(left) - displayWidth(right));
  return padVisible(left + " ".repeat(gap) + right, width);
}

function agentStatusIcon(agent: AgentView): string {
  return agent.status === "success"
    ? `${ansi.green}✔${ansi.reset}`
    : agent.status === "error"
      ? `${ansi.red}✘${ansi.reset}`
      : `${ansi.yellow}…${ansi.reset}`;
}

function agentStatusLabel(status: AgentView["status"]): string {
  if (status === "success") return "Completed";
  if (status === "error") return "Failed";
  if (status === "skipped") return "Skipped";
  return "Running";
}

function formatPhaseLine(
  p: PhaseView,
  index: number,
  phases: PhaseView[],
  selected: boolean,
  showCursor: boolean,
): string {
  const mark = showCursor && selected ? `${ansi.text}>${ansi.reset} ` : "  ";
  const number = `${index + 1} `;
  const status = isPhaseFatal(p, index, phases)
    ? `${ansi.red}✘${ansi.reset} `
    : isPhaseSuccessful(p, index, phases)
      ? `${ansi.green}✔${ansi.reset} `
      : "";
  const counts =
    p.plannedTotal != null && p.plannedTotal > 0
      ? `${ansi.muted} ${p.done}/${p.plannedTotal}${ansi.reset}`
      : p.total > 0
        ? `${ansi.muted} ${p.done}/${p.total}${ansi.reset}`
        : "";
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
    const denom = p.plannedTotal ?? Math.max(p.total, p.agents.length);
    return `${ansi.muted}${p.done}/${denom} agents running…${ansi.reset}`;
  }
  return "";
}

function formatAgentPaneLine(agent: AgentView, selected: boolean, width: number): string {
  const mark = selected ? `${ansi.text}>${ansi.reset} ` : "  ";
  const icon = agentStatusIcon(agent);
  const label = `${mark}${icon} ${agent.label}`;
  const model = agent.model ? `${ansi.muted}  ${agent.model}${ansi.reset}` : "";
  const tok = agent.tokens != null ? `${ansi.muted} · ${agent.tokens} tok${ansi.reset}` : "";
  const dur =
    agent.durationMs != null
      ? `${ansi.muted}${formatDurationMs(agent.durationMs)}${ansi.reset}`
      : "";
  const body = `${label}${model}${tok}`;
  if (dur) return alignRightInCell(body, dur, width);
  return padVisible(body, width);
}

function formatAgentListLine(agent: AgentView, selected: boolean, width: number): string {
  const mark = selected ? `${ansi.text}>${ansi.reset} ` : "  ";
  const icon = agentStatusIcon(agent);
  return padVisible(`${mark}${icon} ${agent.label}`, width);
}

function expandPhaseRightLines(
  phase: PhaseView,
  rightWidth: number,
  selectedAgentIndex: number,
  showAgentCursor: boolean,
): string[] {
  const lines: string[] = [];
  if (!showAgentCursor) {
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
  }
  if (phase.agents.length > 0) {
    phase.agents.forEach((agent, index) => {
      lines.push(
        formatAgentPaneLine(agent, showAgentCursor && index === selectedAgentIndex, rightWidth),
      );
    });
  } else if (!showAgentCursor && !phase.detail && phase.logs.length === 0) {
    const status = phaseStatusLabel(phase);
    if (status) lines.push(status);
  }
  return lines.length ? lines : [""];
}

export function buildAgentDetailLines(agent: AgentView, width: number): string[] {
  const lines: string[] = [];
  const statusLine = `${agentStatusIcon(agent)} ${ansi.text}${agentStatusLabel(agent.status)}${ansi.reset}${
    agent.model ? `${ansi.muted} · ${agent.model}${ansi.reset}` : ""
  }`;
  lines.push(padVisible(statusLine, width));

  const metrics: string[] = [];
  if (agent.tokens != null) metrics.push(`${agent.tokens} tok`);
  if (agent.durationMs != null) metrics.push(formatDurationMs(agent.durationMs));
  if (metrics.length) {
    lines.push(`${ansi.muted}${metrics.join(" · ")}${ansi.reset}`);
  }
  lines.push("");

  if (agent.outputSummary) {
    lines.push(`${ansi.text}Summary${ansi.reset}`);
    for (const part of wrapContentLines(agent.outputSummary, width)) {
      lines.push(part);
    }
    lines.push("");
  }

  lines.push(`${ansi.text}Outcome${ansi.reset}`);
  if (agent.output !== undefined && agent.output !== null) {
    const text =
      typeof agent.output === "string"
        ? agent.output
        : JSON.stringify(agent.output, null, 2);
    for (const part of wrapContentLines(text, width)) {
      lines.push(part);
    }
  } else if (agent.status === "running") {
    lines.push(`${ansi.muted}Agent still running…${ansi.reset}`);
  } else {
    lines.push(`${ansi.muted}No output recorded.${ansi.reset}`);
  }
  return lines;
}

function runListDetail(run: WorkflowRunRecord): string {
  const elapsed = formatDurationMs(runElapsed(run));
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
  const elapsed = formatDurationMs(runElapsed(run));
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

function listScrollForSelection(
  selectedIndex: number,
  total: number,
  viewportRows: number,
): number {
  if (total <= viewportRows) return 0;
  if (selectedIndex < viewportRows) return 0;
  if (selectedIndex >= total - viewportRows) return total - viewportRows;
  return selectedIndex - viewportRows + 1;
}

function renderDetailBody(state: WorkflowsPanelState, cols: number, bodyRows: number): string[] {
  const phase = state.phases[state.selectedPhaseIndex];
  const { leftWidth, rightWidth } = splitColumnWidths(cols);
  const phaseFocus = state.detailFocus === "phase";

  const leftHeader = "Phases";
  const rightHeader = phase
    ? `${phase.title} · ${phase.agents.length} agents`
    : "No phase selected";

  const leftLines = state.phases.map((p, i) =>
    formatPhaseLine(p, i, state.phases, i === state.selectedPhaseIndex, phaseFocus),
  );
  const rightLines = phase
    ? expandPhaseRightLines(
        phase,
        rightWidth,
        state.selectedAgentIndex,
        !phaseFocus,
      )
    : [""];

  const viewportRows = Math.max(1, bodyRows - 2);
  const leftScroll = listScrollForSelection(
    state.selectedPhaseIndex,
    leftLines.length,
    viewportRows,
  );
  const rightScroll = phaseFocus
    ? 0
    : listScrollForSelection(state.selectedAgentIndex, rightLines.length, viewportRows);

  const rows: string[] = [];
  rows.push(padRow(splitTopRow(leftHeader, rightHeader, leftWidth, rightWidth), cols));

  for (let i = 0; i < viewportRows; i++) {
    rows.push(
      padRow(
        splitDataRow(
          leftLines[leftScroll + i] ?? "",
          rightLines[rightScroll + i] ?? "",
          leftWidth,
          rightWidth,
        ),
        cols,
      ),
    );
  }

  rows.push(padRow(splitBottomRow(leftWidth, rightWidth), cols));
  return rows;
}

function renderAgentBody(state: WorkflowsPanelState, cols: number, bodyRows: number): string[] {
  const phase = state.phases[state.selectedPhaseIndex];
  const agent = phase?.agents[state.selectedAgentIndex];
  if (!phase || !agent) return [padRow("No agent selected", cols)];

  const { leftWidth, rightWidth } = agentSplitColumnWidths(cols);
  const leftHeader = fitLine(`${phase.title} · ${phase.agents.length} agents`, leftWidth);
  const rightHeader = fitLine(agent.label, rightWidth);

  const leftLines = phase.agents.map((a, i) =>
    formatAgentListLine(a, i === state.selectedAgentIndex, leftWidth),
  );

  const detailLines = buildAgentDetailLines(agent, rightWidth);
  const viewportRows = Math.max(1, bodyRows - 2);
  const maxDetailScroll = Math.max(0, detailLines.length - viewportRows);
  const detailScroll = Math.min(state.agentDetailScroll, maxDetailScroll);
  const rightLines = detailLines.slice(detailScroll, detailScroll + viewportRows);
  while (rightLines.length < viewportRows) rightLines.push("");

  const listScroll = listScrollForSelection(
    state.selectedAgentIndex,
    leftLines.length,
    viewportRows,
  );

  const rows: string[] = [];
  rows.push(padRow(splitTopRow(leftHeader, rightHeader, leftWidth, rightWidth), cols));

  for (let i = 0; i < viewportRows; i++) {
    rows.push(
      padRow(
        splitDataRow(leftLines[listScroll + i] ?? "", rightLines[i] ?? "", leftWidth, rightWidth),
        cols,
      ),
    );
  }

  rows.push(padRow(splitBottomRow(leftWidth, rightWidth), cols));
  return rows;
}

export function agentDetailScrollHint(
  state: WorkflowsPanelState,
  bodyRows: number,
  cols: number,
): string | undefined {
  if (state.view !== "agent") return undefined;
  const phase = state.phases[state.selectedPhaseIndex];
  const agent = phase?.agents[state.selectedAgentIndex];
  if (!phase || !agent) return undefined;
  const { rightWidth } = agentSplitColumnWidths(cols);
  const detailLines = buildAgentDetailLines(agent, rightWidth);
  const viewportRows = Math.max(1, bodyRows - 2);
  const maxScroll = Math.max(0, detailLines.length - viewportRows);
  if (maxScroll <= 0) return undefined;
  const scroll = Math.min(state.agentDetailScroll, maxScroll);
  const from = scroll + 1;
  const to = Math.min(scroll + viewportRows, detailLines.length);
  const arrow = scroll < maxScroll ? " ↓" : scroll > 0 ? " ↑" : "";
  return `${from}-${to} of ${detailLines.length}${arrow}`;
}

export function workflowsPanelFooterHints(
  state: WorkflowsPanelState,
  opts?: { scrollHint?: string; cols?: number },
): string {
  return footerHints(state, opts);
}

function footerHints(
  state: WorkflowsPanelState,
  opts?: { scrollHint?: string; cols?: number },
): string {
  const cols = opts?.cols ?? 80;
  if (state.view === "agent") {
    const hints = `${ansi.muted}↑/↓ agent · j/k scroll · esc back · s save${ansi.reset}`;
    const hint = opts?.scrollHint;
    if (hint) {
      return alignRight(hints, `${ansi.muted}${hint}${ansi.reset}`, cols);
    }
    return hints;
  }
  if (state.view === "detail") {
    const run = state.runs[state.selectedIndex];
    const running = run?.status === "running" || run?.status === "pending";
    const hints =
      state.detailFocus === "phase"
        ? ["↑/↓ phase", "Enter/→ agents", "esc back", "s save"]
        : ["↑/↓ agent", "Enter/→ detail", "←/esc back", "s save"];
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
    set(workflowsPanelFooterHints(state, { cols }));
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
      ? renderAgentBody(state, cols, bodyRows)
      : renderDetailBody(state, cols, bodyRows);

  for (const line of body) {
    if (row >= footerRow) break;
    set(line);
  }
  while (row < footerRow) set("");

  const scrollHint =
    state.view === "agent" ? agentDetailScrollHint(state, bodyRows, cols) : undefined;
  screen[footerRow] = padRow(workflowsPanelFooterHints(state, { scrollHint, cols }), cols);
  return screen;
}

/** Legacy line list — used in tests; prefer renderWorkflowsFullScreen in layout. */
export function renderWorkflowsPanelLines(state: WorkflowsPanelState, cols: number): string[] {
  return renderWorkflowsFullScreen(state, cols, 40).filter((line) => line.trim().length > 0);
}

export function createInitialWorkflowsPanelState(
  runs: WorkflowRunRecord[] = [],
): WorkflowsPanelState {
  return {
    view: "list",
    runs,
    selectedIndex: 0,
    selectedPhaseIndex: 0,
    selectedAgentIndex: 0,
    phases: [],
    detailFocus: "phase",
    agentDetailScroll: 0,
  };
}
