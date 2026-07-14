import { describe, expect, it } from "vitest";
import {
  agentCompletedSummary,
  agentFinishedTimelineLine,
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
    expect(text).toContain("agentId: aabc1234");
    expect(text).toContain("explore");
    expect(text).toContain("Async agent launched successfully");
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
    expect(agentFinishedTimelineLine({
      taskId: "aabc1234",
      subagentName: "explore",
      description: "Scan auth module",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:30.000Z",
    })).toBe('Agent "Scan auth module" finished');
    expect(agentCompletedSummary({
      taskId: "aabc1234",
      subagentName: "explore",
      description: "Scan auth module",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:30.000Z",
    })).toContain('finished · 30s');
  });
});
