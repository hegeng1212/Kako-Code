import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import { renderWorkflowsFullScreen, type WorkflowsPanelState } from "./workflows-panel.js";
import type { WorkflowRunRecord } from "@kako/core";

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

describe("renderWorkflowsFullScreen", () => {
  it("renders list view with runId and hints", () => {
    const state: WorkflowsPanelState = {
      view: "list",
      runs: [sampleRun(), sampleRun({ taskId: "w2", runId: "wf_2" })],
      selectedIndex: 1,
      selectedPhaseIndex: 0,
      selectedAgentIndex: 0,
      phases: [],
    };
    const text = renderWorkflowsFullScreen(state, 120, 24).map((l) => stripAnsi(l)).join("\n");
    expect(text).toContain("Dynamic workflows");
    expect(text).toContain("2 completed");
    expect(text).toContain("deep-research");
    expect(text).toContain("wf_1");
    expect(text).toContain("↑/↓ to select · Enter to view · s to save · Esc to close");
  });

  it("renders running list entry with current phase", () => {
    const state: WorkflowsPanelState = {
      view: "list",
      runs: [
        sampleRun({
          status: "running",
          currentPhase: "Search",
          agentsDone: 2,
          agentsTotal: 10,
        }),
      ],
      selectedIndex: 0,
      selectedPhaseIndex: 0,
      selectedAgentIndex: 0,
      phases: [],
    };
    const text = renderWorkflowsFullScreen(state, 120, 24).map((l) => stripAnsi(l)).join("\n");
    expect(text).toContain("2/10 agents");
    expect(text).toContain("Search");
    expect(text).toContain("x to stop");
  });

  it("renders detail view with phases, logs, and agents", () => {
    const state: WorkflowsPanelState = {
      view: "detail",
      runs: [sampleRun({ runId: "wf_abc" })],
      selectedIndex: 0,
      selectedPhaseIndex: 1,
      selectedAgentIndex: 0,
      phases: [
        {
          title: "Scope",
          detail: "Decompose question",
          entered: true,
          done: 1,
          total: 1,
          failed: 0,
          logs: ["Q: test question"],
          agents: [
            {
              label: "scope",
              status: "success",
              tokens: 100,
              durationMs: 1200,
              outputSummary: "Decomposed into 5 angles",
            },
          ],
        },
        {
          title: "Search",
          detail: "Parallel search",
          entered: true,
          done: 0,
          total: 5,
          failed: 0,
          logs: ["Search: 5 angles"],
          agents: [
            { label: "search:primary", status: "running" },
            { label: "search:news", status: "running" },
          ],
        },
      ],
    };
    const text = renderWorkflowsFullScreen(state, 120, 30).map((l) => stripAnsi(l)).join("\n");
    expect(text).toContain("deep-research");
    expect(text).toContain("Phases");
    expect(text).toContain("· Search: 5 angl");
    expect(text).toContain("search:primary");
    expect(text).toContain("↑/↓ select");
  });

  it("renders agent detail view with output summary", () => {
    const state: WorkflowsPanelState = {
      view: "agent",
      runs: [sampleRun()],
      selectedIndex: 0,
      selectedPhaseIndex: 0,
      selectedAgentIndex: 0,
      phases: [
        {
          title: "Scope",
          detail: "Decompose question",
          entered: true,
          done: 1,
          total: 1,
          failed: 0,
          logs: [],
          agents: [
            {
              label: "scope",
              status: "success",
              tokens: 100,
              durationMs: 1200,
              outputSummary: "Decomposed into 5 angles",
            },
          ],
        },
      ],
    };
    const text = renderWorkflowsFullScreen(state, 120, 20).map((l) => stripAnsi(l)).join("\n");
    expect(text).toContain("Summary");
    expect(text).toContain("Decomposed into 5 angles");
    expect(text).toContain("esc back to phases");
  });

  it("wraps long phase detail and aligns split-pane borders to terminal width", () => {
    const longDetail =
      "Decompose question (from args) into 5 search angles with independent coverage across market, policy, and consumer trends";
    const state: WorkflowsPanelState = {
      view: "detail",
      runs: [sampleRun({ status: "running", agentsDone: 0, agentsTotal: 1 })],
      selectedIndex: 0,
      selectedPhaseIndex: 0,
      selectedAgentIndex: 0,
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
    };
    const cols = 80;
    const screen = renderWorkflowsFullScreen(state, cols, 30);
    const boxLines = screen
      .map((line) => stripAnsi(line))
      .filter((line) => line.includes("│") || line.includes("┌") || line.includes("└"));
    for (const line of boxLines) {
      expect(line.length).toBeLessThanOrEqual(cols);
      if (line.includes("│") && line.trimEnd().endsWith("│")) {
        expect(line.length).toBe(cols);
      }
    }
    const joined = screen.map((l) => stripAnsi(l)).join("\n");
    expect(joined).toContain("Decompose question (from args) into 5 search");
    expect(joined).not.toContain("angles with independent coverage across market, policy, and consumer trends");
  });
});
