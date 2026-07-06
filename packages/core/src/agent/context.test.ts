import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@kako/shared";
import {
  buildMessages,
  buildSystemPromptBase,
  formatEnvironmentSection,
  formatUserContextReminder,
  wrapUserMessageForLlm,
} from "./context.js";
import type { AgentDefinition } from "@kako/shared";

function transcriptMsg(
  partial: Omit<TranscriptMessage, "id" | "timestamp">,
): TranscriptMessage {
  return {
    id: "msg-test",
    timestamp: new Date().toISOString(),
    ...partial,
  };
}

const baseDefinition = {
  name: "main",
  description: "test",
  model: "",
  systemPrompt: "You are Kako.",
  subagents: ["explore", "plan"],
};

describe("formatUserContextReminder", () => {
  it("includes KAKO.md body and current date", () => {
    const now = new Date("2026-07-06T16:00:00");
    const text = formatUserContextReminder("# Project rules\nUse pnpm.", now);
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("# Project rules");
    expect(text).toContain("# currentDate");
    expect(text).toContain("Today's date is 2026/07/06 16:00.");
    expect(text).toContain("may or may not be relevant");
  });

  it("works when workspace KAKO.md is empty", () => {
    const text = formatUserContextReminder(undefined);
    expect(text).toContain("# currentDate");
    expect(text).not.toContain("undefined");
  });
});

describe("wrapUserMessageForLlm", () => {
  it("prepends reminder before user text", () => {
    const wrapped = wrapUserMessageForLlm("你好", "# Rules", new Date("2026-07-06T09:30:00"));
    expect(wrapped).toMatch(/^<system-reminder>/);
    expect(wrapped).toContain("# Rules");
    expect(wrapped.endsWith("你好")).toBe(true);
  });
});

describe("buildSystemPromptBase", () => {
  it("puts global context and environment in system, not project KAKO", () => {
    const system = buildSystemPromptBase(baseDefinition, {
      globalContext: "Always use TypeScript.",
      environment: {
        cwd: "/tmp/proj",
        isGitRepository: true,
        platform: "darwin",
        shell: "/bin/zsh",
        model: "claude-sonnet-4",
      },
    });
    expect(system).toContain("You are Kako.");
    expect(system).toContain("# Environment");
    expect(system).toContain("/tmp/proj");
    expect(system).toContain("## User Instructions");
    expect(system).toContain("Always use TypeScript.");
    expect(system).toContain("Available agent types");
    expect(system).not.toContain("## Project Context");
  });

  it("includes rich sub-agent catalog when definitions are provided", () => {
    const subagents: AgentDefinition[] = [
      {
        name: "explore",
        description: "Read-only search agent.",
        model: "",
        systemPrompt: "explore",
        disallowedTools: ["Agent", "Write"],
      },
    ];
    const system = buildSystemPromptBase(baseDefinition, { subagentDefinitions: subagents });
    expect(system).toContain("# Context management");
    expect(system).toContain("- explore: Read-only search agent.");
    expect(system).toContain("All tools except Agent, Write");
    expect(system).toContain("multiple tool uses so they run concurrently");
  });
});

describe("buildMessages", () => {
  const environment = {
    cwd: "/workspace",
    isGitRepository: false,
    platform: "darwin",
    shell: "/bin/zsh",
    model: "test-model",
  };

  it("wraps user messages with system-reminder and keeps assistant raw", async () => {
    const now = new Date("2026-07-06T12:00:00");
    const messages = await buildMessages({
      definition: baseDefinition,
      transcript: [
        transcriptMsg({ role: "user", content: "你好" }),
        transcriptMsg({ role: "assistant", content: "你好！" }),
        transcriptMsg({ role: "user", content: "继续" }),
      ],
      workspaceKakoMd: "Team uses Kako.",
      environment,
      now,
    });

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain(formatEnvironmentSection(environment).trim());
    expect(messages[1]?.content).toContain("<system-reminder>");
    expect(messages[1]?.content).toContain("Team uses Kako.");
    expect(messages[1]?.content).toContain("你好");
    expect(messages[2]?.content).toBe("你好！");
    expect(messages[3]?.content).toContain("继续");
    expect(messages[3]?.content).toContain("<system-reminder>");
  });

  it("replays assistant tool_calls before tool results", async () => {
    const messages = await buildMessages({
      definition: baseDefinition,
      transcript: [
        transcriptMsg({ role: "user", content: "开始" }),
        transcriptMsg({
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tu-1", name: "Bash", input: { command: "ls" } }],
        }),
        transcriptMsg({
          role: "tool",
          content: "file.txt",
          toolCallId: "tu-1",
          toolName: "Bash",
        }),
      ],
      environment,
      now: new Date("2026-07-06T12:00:00"),
    });

    const bashToolIdx = messages.findIndex((m) => m.role === "tool" && m.name === "Bash");
    expect(messages[bashToolIdx - 1]?.toolCalls?.[0]?.name).toBe("Bash");
  });
});
