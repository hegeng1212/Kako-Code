import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentDefinition, LLMMessage, SkillMetadata, TranscriptMessage } from "@kako/shared";
import { buildUserContentBlocks } from "../media/attachments.js";
import { mergeTextWithBlocks } from "../llm/content-blocks.js";
import { formatSkillsIndex } from "../skills/loader.js";
import { formatSubagentSystemReminder } from "./subagent-catalog.js";

export interface EnvironmentInfo {
  cwd: string;
  isGitRepository: boolean;
  platform: string;
  shell: string;
  model: string;
}

export interface MessageBuildOptions {
  definition: AgentDefinition;
  transcript: TranscriptMessage[];
  workspaceKakoMd?: string;
  globalContext?: string;
  sessionSummary?: string;
  availableSkills?: SkillMetadata[];
  environment: EnvironmentInfo;
  now?: Date;
  /** Loaded sub-agent definitions for Agent tool catalog in system prompt. */
  subagentDefinitions?: AgentDefinition[];
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await access(join(resolve(cwd), ".git"));
    return true;
  } catch {
    return false;
  }
}

export async function resolveEnvironmentInfo(cwd: string, model: string): Promise<EnvironmentInfo> {
  return {
    cwd: resolve(cwd),
    isGitRepository: await isGitRepository(cwd),
    platform: process.platform,
    shell: process.env.SHELL ?? "unknown",
    model,
  };
}

export function formatEnvironmentSection(env: EnvironmentInfo): string {
  return `\n\n# Environment
You have been invoked in the following environment:
 - Primary working directory: ${env.cwd}
 - Is a git repository: ${env.isGitRepository}
 - Platform: ${env.platform}
 - Shell: ${env.shell}
 - Model: ${env.model}`;
}

export function formatCurrentDateLine(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `Today's date is ${y}/${m}/${d} ${hours}:${minutes}.`;
}

/** Harness-injected context block prepended to each user message sent to the LLM. */
export function formatUserContextReminder(workspaceKakoMd?: string, now = new Date()): string {
  const contextBody = workspaceKakoMd?.trim() ?? "";
  const contextSection = contextBody ? `${contextBody}\n` : "";
  return `<system-reminder>
As you answer the user's questions, you can use the following context:
${contextSection}# currentDate
${formatCurrentDateLine(now)}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>`;
}

export function wrapUserMessageForLlm(
  userText: string,
  workspaceKakoMd?: string,
  now = new Date(),
): string {
  return `${formatUserContextReminder(workspaceKakoMd, now)}\n\n${userText}`;
}

export function formatSubagentReminder(subagents: string[]): string {
  const lines = subagents.map((name) => `- ${name}`);
  return `\n\n<system-reminder>
Available agent types for the Agent tool:
${lines.join("\n")}
</system-reminder>`;
}

export function buildSystemPromptBase(
  definition: AgentDefinition,
  options: {
    globalContext?: string;
    sessionSummary?: string;
    environment?: EnvironmentInfo;
    subagentDefinitions?: AgentDefinition[];
  },
): string {
  let system = definition.systemPrompt;
  if (options.environment) {
    system += formatEnvironmentSection(options.environment);
  }
  if (options.globalContext) {
    system += `\n\n## User Instructions\n\n${options.globalContext}`;
  }
  if (options.sessionSummary) {
    system += `\n\n## Previous Session Summary\n\n${options.sessionSummary}`;
  }
  const catalog =
    options.subagentDefinitions?.length
      ? formatSubagentSystemReminder(options.subagentDefinitions)
      : definition.subagents?.length
        ? formatSubagentReminder(definition.subagents)
        : "";
  if (catalog) {
    system += catalog;
  }
  return system;
}

export async function buildMessages(options: MessageBuildOptions): Promise<LLMMessage[]> {
  const now = options.now ?? new Date();
  let system = buildSystemPromptBase(options.definition, {
    globalContext: options.globalContext,
    sessionSummary: options.sessionSummary,
    environment: options.environment,
    subagentDefinitions: options.subagentDefinitions,
  });
  if (options.availableSkills?.length) {
    system += formatSkillsIndex(options.availableSkills);
  }

  const messages: LLMMessage[] = [{ role: "system", content: system }];

  for (const msg of options.transcript) {
    if (msg.role === "user") {
      const body = await buildUserContentBlocks(msg.content, msg.attachments);
      messages.push({
        role: "user",
        content: mergeTextWithBlocks(
          formatUserContextReminder(options.workspaceKakoMd, now),
          body,
        ),
      });
    } else if (msg.role === "assistant") {
      const assistant: LLMMessage = { role: "assistant", content: msg.content };
      if (msg.toolCalls?.length) {
        assistant.toolCalls = msg.toolCalls;
      }
      messages.push(assistant);
    }
    if (msg.role === "tool") {
      messages.push({
        role: "tool",
        content: msg.content,
        toolCallId: msg.toolCallId,
        name: msg.toolName,
      });
    }
  }

  return messages;
}
