import { describe, expect, it } from "vitest";
import { displayWidth, stripAnsi } from "./ansi.js";
import {
  createInitialWorkflowsPanelState,
  renderWorkflowsFullScreen,
  type WorkflowsPanelState,
} from "./workflows-panel.js";
import { isPhaseFatal, isPhaseSuccessful } from "@kako/core";
import type { PhaseView, WorkflowRunRecord } from "@kako/core";

function sampleRun(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    taskId: "w1",
    runId: "wf_1",
    name: "deep-research",
    description:
      "Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.",
    status: "completed",
    scriptPath: "/tmp/deep-research.js",
    transcriptDir: "/tmp/transcripts",
    startedAt: new Date(Date.now() - 5000).toISOString(),
    completedAt: new Date().toISOString(),
    agentsTotal: 0,
    agentsDone: 0,
    agentsFailed: 0,
    ...overrides,
  };
}

function baseState(overrides: Partial<WorkflowsPanelState> = {}): WorkflowsPanelState {
  return { ...createInitialWorkflowsPanelState([sampleRun()]), ...overrides };
}

const scopePhase = (): PhaseView => ({
  title: "Scope",
  detail: "Decompose question",
  entered: true,
  done: 1,
  total: 1,
  plannedTotal: 1,
  failed: 0,
  logs: ["Q: test question"],
  agents: [
    {
      label: "scope",
      status: "success",
      model: "doubao-seed-2-0-pro-260215",
      tokens: 0,
      durationMs: 30_000,
      outputSummary: "Decomposed into 5 angles",
      output: { angles: [{ label: "a" }], summary: "ok" },
    },
  ],
});

function borderDisplayCol(line: string, marker: string, occurrence = 0): number {
  let seen = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== marker) continue;
    if (seen === occurrence) return displayWidth(line.slice(0, i));
    seen++;
  }
  return -1;
}

describe("renderWorkflowsFullScreen", () => {
  it("renders list view with runId and hints", () => {
    const state = baseState({ view: "list", runs: [sampleRun(), sampleRun({ taskId: "w2", runId: "wf_2" })] });
    const text = renderWorkflowsFullScreen(state, 120, 24).map((l) => stripAnsi(l)).join("\n");
    expect(text).toContain("Dynamic workflows");
    expect(text).toContain("deep-research");
    expect(text).toContain("↑/↓ to select · Enter to view · s to save · Esc to close");
  });

  it("renders detail view with phase cursor on left when detailFocus is phase", () => {
    const state = baseState({
      view: "detail",
      detailFocus: "phase",
      selectedPhaseIndex: 0,
      phases: [scopePhase(), { title: "Search", entered: false, done: 0, total: 5, plannedTotal: 5, failed: 0, logs: [], agents: [] }],
    });
    const text = renderWorkflowsFullScreen(state, 120, 30).map((l) => stripAnsi(l)).join("\n");
    expect(text).toMatch(/>\s*✔\s*1 Scope/);
    expect(text).toContain("scope");
    expect(text).not.toMatch(/>\s*✔\s*scope/);
    expect(text).toContain("↑/↓ phase · Enter/→ agents");
  });

  it("renders detail view with agent cursor on right when detailFocus is agent", () => {
    const state = baseState({
      view: "detail",
      detailFocus: "agent",
      selectedPhaseIndex: 0,
      selectedAgentIndex: 0,
      phases: [scopePhase()],
    });
    const text = renderWorkflowsFullScreen(state, 120, 30).map((l) => stripAnsi(l)).join("\n");
    expect(text).not.toMatch(/>\s*✔\s*1 Scope/);
    expect(text).toMatch(/>\s*✔\s*scope/);
    expect(text).toContain("↑/↓ agent · Enter/→ detail");
  });

  it("renders agent split view with outcome on the right", () => {
    const state = baseState({
      view: "agent",
      selectedPhaseIndex: 0,
      selectedAgentIndex: 0,
      phases: [scopePhase()],
    });
    const text = renderWorkflowsFullScreen(state, 120, 30).map((l) => stripAnsi(l)).join("\n");
    expect(text).toMatch(/>\s*✔\s*scope/);
    expect(text).toContain("Outcome");
    expect(text).toContain("↑/↓ agent · j/k scroll · esc back");
  });

  it("wraps long phase detail and aligns split-pane borders to terminal width", () => {
    const longDetail =
      "Decompose question (from args) into 5 search angles with independent coverage across market, policy, and consumer trends";
    const state = baseState({
      view: "detail",
      detailFocus: "phase",
      runs: [sampleRun({ status: "running", agentsDone: 0, agentsTotal: 1 })],
      phases: [
        {
          title: "Scope",
          detail: longDetail,
          entered: true,
          done: 0,
          total: 1,
          failed: 0,
          logs: [],
          agents: [{ label: "scope", status: "running" }],
        },
        { title: "Search", detail: "", entered: false, done: 0, total: 5, failed: 0, logs: [], agents: [] },
      ],
    });
    const cols = 80;
    const screen = renderWorkflowsFullScreen(state, cols, 30);
    const boxLines = screen
      .map((line) => stripAnsi(line))
      .filter((line) => line.includes("│") || line.includes("┌") || line.includes("└"));
    for (const line of boxLines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(cols);
      if (line.includes("│") && line.trimEnd().endsWith("│")) {
        expect(displayWidth(line)).toBe(cols);
      }
    }
  });

  it("keeps left, middle, and right border columns aligned across box rows", () => {
    const state = baseState({
      view: "detail",
      detailFocus: "phase",
      runs: [sampleRun({ status: "running", agentsDone: 34, agentsTotal: 54 })],
      phases: [
        {
          title: "Scope",
          detail:
            "Decompose question (from args) into 5 search angles with independent coverage across market, policy, and consumer trends",
          entered: true,
          done: 1,
          total: 1,
          plannedTotal: 1,
          failed: 0,
          logs: ["Q: 中国母婴行业"],
          agents: [
            {
              label: "scope",
              status: "success",
              model: "doubao-seed-2-0-pro-260215",
              tokens: 100,
              durationMs: 30_000,
              outputSummary: "Decomposed into 5 angles",
            },
          ],
        },
        { title: "Search", entered: false, done: 0, total: 5, plannedTotal: 5, failed: 0, logs: [], agents: [] },
      ],
    });
    const cols = 120;
    const screen = renderWorkflowsFullScreen(state, cols, 30);
    const boxLines = screen
      .map((line) => stripAnsi(line))
      .filter((line) => /[│┌└┬┴┐┘]/.test(line));

    const leftCols = new Set<number>();
    const midCols = new Set<number>();
    const rightCols = new Set<number>();

    for (const line of boxLines) {
      const left = borderDisplayCol(line, "│", 0);
      const leftCorner = borderDisplayCol(line, "┌", 0);
      const leftEdge = left >= 0 ? left : leftCorner;
      if (leftEdge >= 0) leftCols.add(leftEdge);

      const mid = borderDisplayCol(line, "┬", 0);
      const midBar = borderDisplayCol(line, "│", 1);
      if (mid >= 0) midCols.add(mid);
      else if (midBar > leftEdge) midCols.add(midBar);

      const rightCorner = borderDisplayCol(line, "┐", 0);
      const rightBar = borderDisplayCol(line, "│", 2);
      const rightEnd = borderDisplayCol(line, "┘", 0);
      if (rightBar > leftEdge) rightCols.add(rightBar);
      if (rightCorner >= 0) rightCols.add(rightCorner);
      if (rightEnd >= 0) rightCols.add(rightEnd);
    }

    expect(leftCols.size, `left border cols: ${[...leftCols]}`).toBe(1);
    expect(midCols.size, `mid border cols: ${[...midCols]}`).toBe(1);
    expect(rightCols.size, `right border cols: ${[...rightCols]}`).toBe(1);
  });

  it("shows check when a phase had failures but workflow continued", () => {
    const phases: PhaseView[] = [
      {
        title: "Search",
        entered: true,
        done: 4,
        total: 5,
        plannedTotal: 5,
        failed: 1,
        logs: [],
        agents: [],
      },
      {
        title: "Fetch",
        entered: true,
        done: 0,
        total: 20,
        plannedTotal: 20,
        failed: 0,
        logs: [],
        agents: [],
      },
    ];
    expect(isPhaseFatal(phases[0]!, 0, phases)).toBe(false);
    expect(isPhaseSuccessful(phases[0]!, 0, phases)).toBe(true);
    const state = baseState({ view: "detail", detailFocus: "phase", phases });
    const text = renderWorkflowsFullScreen(state, 120, 24).map((l) => stripAnsi(l)).join("\n");
    expect(text).toContain("✔");
    expect(text).not.toMatch(/Search.*✘/);
  });

  it("scrolls the phase list in detail view so the cursor stays visible", () => {
    const phases = Array.from({ length: 20 }, (_, i) => ({
      title: `Phase-${i}`,
      entered: true,
      done: 1,
      total: 1,
      failed: 0,
      logs: [],
      agents: [],
    }));
    const state = baseState({
      view: "detail",
      detailFocus: "phase",
      selectedPhaseIndex: 19,
      phases,
    });
    const screen = renderWorkflowsFullScreen(state, 120, 14).map((l) => stripAnsi(l));
    const text = screen.join("\n");
    expect(text).toMatch(/>\s*20 Phase-19/);
    expect(text).not.toMatch(/>\s*1 Phase-0/);
  });

  it("keeps the selected phase visible on the left while browsing agents", () => {
    const phases = Array.from({ length: 20 }, (_, i) => ({
      title: `Phase-${i}`,
      entered: true,
      done: 1,
      total: 1,
      failed: 0,
      logs: [],
      agents:
        i === 19
          ? Array.from({ length: 40 }, (_, j) => ({
              label: `agent-${j}`,
              status: "success" as const,
            }))
          : [],
    }));
    const state = baseState({
      view: "detail",
      detailFocus: "agent",
      selectedPhaseIndex: 19,
      selectedAgentIndex: 0,
      phases,
    });
    const screen = renderWorkflowsFullScreen(state, 120, 14).map((l) => stripAnsi(l));
    const text = screen.join("\n");
    expect(text).toContain("20 Phase-19");
    expect(text).not.toContain("1 Phase-0");
  });

  it("scrolls the agent list in detail view so the cursor stays visible", () => {
    const agents = Array.from({ length: 40 }, (_, i) => ({
      label: `agent-${i}`,
      status: "success" as const,
      model: "ep-test",
      tokens: 0,
      durationMs: 1000,
    }));
    const state = baseState({
      view: "detail",
      detailFocus: "agent",
      selectedPhaseIndex: 0,
      selectedAgentIndex: 39,
      phases: [{ title: "Verify", entered: true, done: 40, total: 40, failed: 0, logs: [], agents }],
    });
    const screen = renderWorkflowsFullScreen(state, 120, 30).map((l) => stripAnsi(l));
    const text = screen.join("\n");
    expect(text).toMatch(/>\s*✔\s*agent-39/);
    expect(text).not.toMatch(/>\s*✔\s*agent-0/);
  });

  it("scrolls the agent list in agent view so the cursor stays visible", () => {
    const agents = Array.from({ length: 40 }, (_, i) => ({
      label: `agent-${i}`,
      status: "success" as const,
      output: `result-${i}`,
    }));
    const state = baseState({
      view: "agent",
      selectedPhaseIndex: 0,
      selectedAgentIndex: 39,
      phases: [{ title: "Verify", entered: true, done: 40, total: 40, failed: 0, logs: [], agents }],
    });
    const screen = renderWorkflowsFullScreen(state, 120, 30).map((l) => stripAnsi(l));
    const text = screen.join("\n");
    expect(text).toMatch(/>\s*✔\s*agent-39/);
    expect(text).not.toMatch(/>\s*✔\s*agent-0/);
  });
});
