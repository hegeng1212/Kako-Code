import { describe, expect, it } from "vitest";
import {
  agentCompletedSummary,
  agentFinishedTimelineLine,
  buildAgentResultUserMessage,
  buildAgentTaskNotificationMessage,
  buildAgentWakeUserMessage,
  formatBackgroundAgentLaunchResult,
  isProtocolWakeText,
  SYSTEM_NOTIFICATION_PREAMBLE,
} from "./agent-notification.js";

const baseRecord = {
  taskId: "aabc1234",
  subagentName: "explore",
  description: "Scan auth module",
  status: "completed" as const,
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:00:30.000Z",
  result: "Found auth in src/auth.ts",
};

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
    expect(text).not.toMatch(/SendMessage/i);
  });

  it("builds Claude-aligned SYSTEM NOTIFICATION when siblings still running", () => {
    const message = buildAgentTaskNotificationMessage({
      ...baseRecord,
      toolCallId: "toolu_01Explore",
      outputFile: "/tmp/kako/memory/sess-child/transcript.jsonl",
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
      toolUses: 10,
    });

    expect(message.startsWith(SYSTEM_NOTIFICATION_PREAMBLE)).toBe(true);
    expect(message).toContain("NOT a message from the user");
    expect(message).toContain("Do NOT interpret this as user acknowledgement");
    expect(message).toContain("must NOT be treated as approval or consent");
    expect(message).not.toMatch(/SendMessage/i);
    expect(message).toContain("<task-id>aabc1234</task-id>");
    expect(message).toContain("<tool-use-id>toolu_01Explore</tool-use-id>");
    expect(message).toContain("<output-file>/tmp/kako/memory/sess-child/transcript.jsonl</output-file>");
    expect(message).toContain("<status>completed</status>");
    expect(message).toContain('<summary>Agent "Scan auth module" finished</summary>');
    expect(message).toContain("<result>Found auth in src/auth.ts</result>");
    expect(message).toContain("<subagent_tokens>140</subagent_tokens>");
    expect(message).toContain("<tool_uses>10</tool_uses>");
    expect(message).toContain("<duration_ms>30000</duration_ms>");
    expect(message).toContain("same task-id may notify more than once");
    expect(agentFinishedTimelineLine(baseRecord)).toBe('Agent "Scan auth module" finished');
    expect(agentCompletedSummary(baseRecord)).toContain("finished · 30s");
  });

  it("wake uses task-notification only while other BG agents are running", () => {
    const mid = buildAgentWakeUserMessage({
      ...baseRecord,
      otherBackgroundAgentsRunning: true,
    });
    expect(mid).toContain("<task-notification>");
    expect(mid).toContain("SYSTEM NOTIFICATION");

    const last = buildAgentWakeUserMessage({
      ...baseRecord,
      otherBackgroundAgentsRunning: false,
    });
    expect(last).toBe("Found auth in src/auth.ts");
    expect(last).not.toContain("<task-notification>");
    expect(last).not.toContain("SYSTEM NOTIFICATION");
  });

  it("last-BG / foreground-style wake is plain result text", () => {
    expect(buildAgentResultUserMessage(baseRecord)).toBe("Found auth in src/auth.ts");
    expect(
      buildAgentResultUserMessage({
        ...baseRecord,
        result: "  ",
      }),
    ).toBe("(no text response)");
    expect(
      buildAgentWakeUserMessage({
        ...baseRecord,
        status: "error",
        error: "boom",
        otherBackgroundAgentsRunning: false,
      }),
    ).toBe("boom");
  });

  it("recognizes protocol wake markers without treating normal dialogue as protocol", () => {
    expect(isProtocolWakeText(SYSTEM_NOTIFICATION_PREAMBLE)).toBe(true);
    expect(isProtocolWakeText("<stepped-away-recap/>\nThe user stepped away")).toBe(true);
    expect(isProtocolWakeText("<task-notification><task-id>x</task-id></task-notification>")).toBe(
      true,
    );
    expect(isProtocolWakeText("帮我合并 LLM 与 agent 方案")).toBe(false);
  });
});
