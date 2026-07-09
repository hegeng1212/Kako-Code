import { describe, expect, it } from "vitest";
import type { WorkflowRunRecord } from "./store.js";
import { buildTaskNotificationMessage, workflowCompletedSummary } from "./task-notification.js";

const SESSION_ID = "sess-test-1";

function sampleRecord(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    taskId: "wabc1234",
    runId: "wf_abc1234",
    name: "deep-research",
    description: "Deep research harness",
    status: "completed",
    scriptPath: "/tmp/script.js",
    transcriptDir: "/tmp/transcript",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:30.000Z",
    agentsTotal: 25,
    agentsDone: 25,
    agentsFailed: 0,
    result: { summary: "done" },
    ...overrides,
  };
}

describe("buildTaskNotificationMessage", () => {
  it("builds task-notification XML for completed runs", () => {
    const message = buildTaskNotificationMessage(sampleRecord(), { sessionId: SESSION_ID });
    expect(message).toContain("<task-notification>");
    expect(message).toContain("<task-id>wabc1234</task-id>");
    expect(message).toContain("<run-id>wf_abc1234</run-id>");
    expect(message).toContain(`<session-id>${SESSION_ID}</session-id>`);
    expect(message).toContain("<status>completed</status>");
    expect(message).toContain('Dynamic workflow "Deep research harness" completed');
    expect(message).toContain("<report-save-dir>");
    expect(message).toContain("/reports");
    expect(message).toContain('"summary":"done"');
    expect(message).toContain("<instructions>");
    expect(message).toContain("Do NOT paste the raw <result> JSON");
    expect(message).toContain("</task-notification>");
  });

  it("includes error tag for failed runs", () => {
    const message = buildTaskNotificationMessage(
      sampleRecord({ status: "error", error: "No research question provided", result: undefined }),
      { sessionId: SESSION_ID },
    );
    expect(message).toContain("<status>error</status>");
    expect(message).toContain("<error>No research question provided</error>");
  });

  it("includes stopped status for user-stopped runs", () => {
    const message = buildTaskNotificationMessage(
      sampleRecord({
        status: "stopped",
        error: "Stopped by user",
        result: undefined,
        completedAt: "2026-01-01T00:00:30.000Z",
      }),
      { sessionId: SESSION_ID },
    );
    expect(message).toContain("<status>stopped</status>");
    expect(message).toContain('Dynamic workflow "Deep research harness" stopped');
    expect(message).toContain("<error>Stopped by user</error>");
  });
});

describe("workflowCompletedSummary", () => {
  it("formats elapsed duration", () => {
    expect(workflowCompletedSummary(sampleRecord())).toBe(
      'Dynamic workflow "Deep research harness" completed · 1m 30s',
    );
  });
});
