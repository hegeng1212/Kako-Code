import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
    expect(text).toContain("Today's date is 2026-07-06.");
    expect(text).toContain("may or may not be relevant");
  });

  it("works when workspace KAKO.md is empty", () => {
    const text = formatUserContextReminder(undefined);
    expect(text).toContain("# currentDate");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("file-attachment-contract");
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
    expect(system).toContain("OS Version:");
    expect(system).toContain("configured for this session via Kako provider settings");
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

  it("injects attachment workflow on user messages with document attachments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kako-ctx-"));
      const file = join(dir, "report.csv");
      await writeFile(file, "a,b\n1,2\n", "utf-8");
      try {
        const messages = await buildMessages({
          definition: baseDefinition,
          transcript: [
            transcriptMsg({
              role: "user",
              content: `${file}  summary`,
              attachments: [
                {
                  name: "report.csv",
                  path: file,
                  mimeType: "text/csv",
                  kind: "document",
                },
              ],
            }),
          ],
          environment,
          now: new Date("2026-07-06T12:00:00"),
        });
        const user = messages[1]?.content;
        const text =
          typeof user === "string"
            ? user
            : Array.isArray(user)
              ? user.map((b) => ("text" in b ? b.text : "")).join("\n")
              : String(user);
        expect(text).toContain("<file-attachment-contract>");
        expect(text).toContain("<user-query>");
        expect(text).toContain("First tool");
        expect(text).toContain("Bash");
        expect(text).toContain("summary");
        expect(text).not.toContain("<system-reminder>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("injects skill catalog after subagent catalog with defaults before user skills", async () => {
    const messages = await buildMessages({
      definition: baseDefinition,
      transcript: [transcriptMsg({ role: "user", content: "hi" })],
      environment,
      availableSkills: {
        defaults: [
          {
            name: "init",
            description: "Initialize KAKO.md",
            path: "/init",
            skillMdPath: "/init/SKILL.md",
          },
        ],
        user: [
          {
            name: "custom-skill",
            description: "User skill",
            path: "/custom",
            skillMdPath: "/custom/SKILL.md",
          },
        ],
      },
      now: new Date("2026-07-06T12:00:00"),
    });
    const system = String(messages[0]?.content);
    expect(system).toContain("The following skills are available for use with the Skill tool:");
    const initIdx = system.indexOf("- init:");
    const customIdx = system.indexOf("- custom-skill:");
    expect(initIdx).toBeGreaterThan(-1);
    expect(customIdx).toBeGreaterThan(initIdx);
    expect(system.indexOf("Available agent types")).toBeLessThan(initIdx);
  });

  it("builds init skill pivot user message with core prompt", async () => {
    const { buildInitSkillActivatedMessages } = await import("../tools/builtin/skill.js");
    const messages = buildInitSkillActivatedMessages({
      systemPromptBase: "You are Kako.",
      transcript: [{ role: "user", content: "init" }],
      now: new Date("2026-07-13T12:00:00"),
    });
    const followUp = messages[messages.length - 1];
    expect(followUp?.role).toBe("user");
    expect(String(followUp?.content)).toContain("create a KAKO.md file");
    expect(String(followUp?.content)).toContain("already been initialized");
    expect(String(followUp?.content)).not.toContain("CLAUDE.md");
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
