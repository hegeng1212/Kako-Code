import { describe, expect, it } from "vitest";
import {
  agentCompletedSummary,
  buildAgentTaskNotificationMessage,
  formatBackgroundAgentLaunchResult,
} from "./agent-notification.js";

describe("agent task notification", () => {
  it("formats launch result with task id", () => {
    const text = formatBackgroundAgentLaunchResult({
      taskId: "aabc1234",
      description: "Scan auth module",
      subagentName: "explore",
    });
    expect(text).toContain("Task ID: aabc1234");
    expect(text).toContain("explore");
  });

  it("builds task-notification XML for completed agents", () => {
    const message = buildAgentTaskNotificationMessage({
      taskId: "aabc1234",
      subagentName: "explore",
      description: "Scan auth module",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:30.000Z",
      result: "done",
    });
    expect(message).toContain("<task-notification>");
    expect(message).toContain("<kind>agent</kind>");
    expect(message).toContain("<status>completed</status>");
    expect(agentCompletedSummary({
      taskId: "aabc1234",
      subagentName: "explore",
      description: "Scan auth module",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:30.000Z",
    })).toContain("completed · 30s");
  });
});
