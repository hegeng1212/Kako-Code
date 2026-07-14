import { access } from "node:fs/promises";
import { release } from "node:os";
import { join, resolve } from "node:path";
import type { AgentDefinition, LLMContentBlock, LLMMessage, SessionCapability, TranscriptMessage } from "@kako/shared";
import { buildUserContentBlocks } from "../media/attachments.js";
import {
  attachmentIncludesDocument,
  formatAttachmentSystemPromptAddendum,
} from "../media/attachment-reminders.js";
import { mergeTextWithBlocks } from "../llm/content-blocks.js";
import { formatSkillsIndex, type SkillCatalogPartition } from "../skills/loader.js";
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
  availableSkills?: SkillCatalogPartition;
  environment: EnvironmentInfo;
  now?: Date;
  /** Loaded sub-agent definitions for Agent tool catalog in system prompt. */
  subagentDefinitions?: AgentDefinition[];
  /** Runtime security policy summary injected into system prompt. */
  securityPolicySection?: string;
  capability?: SessionCapability;
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
  const osVersion =
    env.platform === "darwin"
      ? `Darwin ${release()}`
      : env.platform === "win32"
        ? `Windows ${release()}`
        : `${env.platform} ${release()}`;
  return `\n\n# Environment
You have been invoked in the following environment:
 - Primary working directory: ${env.cwd}
 - Is a git repository: ${env.isGitRepository}
 - Platform: ${env.platform}
 - Shell: ${env.shell}
 - OS Version: ${osVersion}
 - Model: ${env.model} (configured for this session via Kako provider settings)`;
}

export function formatCurrentDateLine(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `Today's date is ${y}-${m}-${d}.`;
}

/** Harness-injected optional context (workspace + date). File contracts are injected separately. */
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

function parseStoredLlmBlocks(metadata: Record<string, unknown> | undefined): LLMContentBlock[] | undefined {
  const raw = metadata?.llmBlocks;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const blocks: LLMContentBlock[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      (item as { type?: string }).type === "text" &&
      typeof (item as { text?: string }).text === "string"
    ) {
      blocks.push({ type: "text", text: (item as { text: string }).text });
    }
  }
  return blocks.length ? blocks : undefined;
}

export async function buildMessages(options: MessageBuildOptions): Promise<LLMMessage[]> {
  const now = options.now ?? new Date();
  let system = buildSystemPromptBase(options.definition, {
    globalContext: options.globalContext,
    sessionSummary: options.sessionSummary,
    environment: options.environment,
    subagentDefinitions: options.subagentDefinitions,
  });
  if (options.securityPolicySection) {
    system += options.securityPolicySection;
  }
  if (options.availableSkills) {
    const { defaults, user } = options.availableSkills;
    if (defaults.length || user.length) {
      system += formatSkillsIndex(options.availableSkills);
    }
  }

  const messages: LLMMessage[] = [{ role: "system", content: system }];

  for (const msg of options.transcript) {
    if (msg.role === "user") {
      const llmBlocks = parseStoredLlmBlocks(msg.metadata);
      const llmText =
        typeof msg.metadata?.llmText === "string" ? msg.metadata.llmText : msg.content;
      const body = llmBlocks ?? (await buildUserContentBlocks(llmText, msg.attachments));
      const hasDocumentAttachments = attachmentIncludesDocument(msg.attachments);
      const reminder = hasDocumentAttachments
        ? ""
        : formatUserContextReminder(options.workspaceKakoMd, now);
      messages.push({
        role: "user",
        content: reminder
          ? Array.isArray(body)
            ? [{ type: "text", text: `${reminder}\n\n` }, ...body]
            : mergeTextWithBlocks(reminder, body)
          : body,
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
