import type { LLMRouter, LLMMessage } from "@kako/shared";
import type {
  McpToolInfo,
  SkillBuildChatMessage,
  SkillBuildQuestion,
  SkillBuildTurnResult,
  SkillValidationResult,
} from "@kako/shared";
import { mcpToolName, parseMcpToolName } from "@kako/shared";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildUserContentBlocks } from "../media/attachments.js";
import { storeUploadedAttachments } from "../media/upload.js";
import { findBundledSkillsDir } from "../config/bundled-assets.js";
import { loadProviderRegistry } from "../config/provider-store.js";
import { createLLMRouter, resolveModel } from "../llm/router.js";
import { parseSkillMd } from "./loader.js";
import {
  appendSkillAuthoringLanguageGuidance,
  SKILL_AUTHORING_LANGUAGE_RULES,
} from "./skill-authoring.js";
import {
  buildSkillToolCatalog,
  type SkillToolCatalog,
  validateSkillDependencies,
} from "./skill-deps.js";

const MULTI_TURN_CREATOR = `You help users author Agent Skills (SKILL.md) through multi-turn conversation.

## Your workflow
1. **Clarify first** — Before outputting SKILL.md, ask about triggers, workflow steps, and which tools to call.
2. **Confirm tools** — When the user mentions an **MCP** tool, ask which MCP server/tool they mean (from Available Tools). **Built-in tools** (Read, Write, Edit, Bash, AskUserQuestion, etc.) do NOT need user confirmation.
3. **Iterate** — Refine the draft based on user answers. You may output a partial or updated draft when enough is clear.
4. **Finalize** — When requirements and tools are confirmed, output the complete SKILL.md.

## Output rules
- If you still need user input: reply in plain language with numbered questions. Do NOT output SKILL.md yet.
- If you have enough to produce or update a draft: write a short summary in plain language, then output the raw complete SKILL.md starting with \`---\` frontmatter (NOT inside \`\`\`yaml\`\`\` or other code fences).
- Use tool names exactly as listed under Available Tools (e.g. \`mcp/server-id/tool_name\` or \`AskUserQuestion\`).
- When outputting SKILL.md that calls MCP tools, name each tool exactly as listed under Available Tools, and document parameters per the MCP parameter documentation rules (schema \`required\` → 必填/required).
- One skill = one workflow; keep steps concrete and executable.

## Context scope
- Each request includes only the user's **latest message** in the LLM conversation (not prior turns).
- When a draft is present in system context, treat it as the source of truth for earlier requirements.
- Reply in the same language as the user's latest message (unless structural keys must stay English).`;

async function loadSkillCreatorInstructions(): Promise<string> {
  const bundled = await findBundledSkillsDir();
  if (bundled) {
    try {
      const content = await readFile(join(bundled, "skill-creator", "SKILL.md"), "utf-8");
      const parsed = parseSkillMd(content, join(bundled, "skill-creator", "SKILL.md"));
      return parsed.instructions || MULTI_TURN_CREATOR;
    } catch {
      // fall through
    }
  }
  return MULTI_TURN_CREATOR;
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md|yaml|yml)?\s*\r?\n([\s\S]*?)\r?\n```$/);
  return match ? match[1]!.trim() : trimmed;
}

/** Remove code fences and other artifacts from chat-visible assistant text. */
export function sanitizeAssistantChatMessage(message: string, hadSkillDraft: boolean): string {
  let text = message.trim();

  text = text.replace(/```(?:yaml|yml|markdown|md)?[^\n]*\n[\s\S]*?```/g, "").trim();
  text = text.replace(/^```(?:yaml|yml|markdown|md)?\s*$/gm, "").trim();
  text = text.replace(/```/g, "").trim();
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  if (!text) {
    return hadSkillDraft
      ? "已更新技能草稿，请查看下方「当前草稿」预览，并确认工具依赖。"
      : "请继续补充需求，或回答上方确认问题。";
  }
  return text;
}

export function extractSkillMdFromText(text: string): string | null {
  const trimmed = text.trim();

  for (const match of trimmed.matchAll(/```(?:yaml|yml|markdown|md)?\s*\n([\s\S]*?)```/g)) {
    const inner = match[1]!.trim();
    if (inner.startsWith("---")) return inner;
  }

  const stripped = stripMarkdownFence(trimmed);
  if (stripped.startsWith("---")) return stripped;
  const block = stripped.match(/---[\s\S]*?---[\s\S]+/);
  return block ? block[0].trim() : null;
}

export function splitAssistantBuildResponse(text: string): {
  assistantMessage: string;
  skillMd?: string;
} {
  const skillMd = extractSkillMdFromText(text);
  let message = text.trim();

  if (skillMd) {
    message = message.replace(skillMd, "").trim();
    message = message.replace(/```(?:yaml|yml|markdown|md)?\s*\n[\s\S]*?```/g, "").trim();
  }

  message = sanitizeAssistantChatMessage(message, Boolean(skillMd));

  return {
    assistantMessage: message,
    skillMd: skillMd ?? undefined,
  };
}

export function summarizeMcpInputSchema(inputSchema: Record<string, unknown>): string {
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((item): item is string => typeof item === "string")
    : [];
  const properties =
    inputSchema.properties && typeof inputSchema.properties === "object"
      ? Object.keys(inputSchema.properties as Record<string, unknown>)
      : [];
  if (properties.length === 0) return "no parameters";

  return properties
    .map((name) => {
      const label = required.includes(name) ? "required" : "optional";
      return `\`${name}\` (${label})`;
    })
    .join(", ");
}

export function formatToolCatalogForPrompt(
  catalog: SkillToolCatalog,
  mcpTools: McpToolInfo[],
): string {
  const lines: string[] = ["## Available Tools", "", "### Built-in (main agent)"];
  for (const name of [...catalog.agentBuiltins.keys()].sort()) {
    lines.push(`- ${name}`);
  }
  lines.push("", "### MCP tools (connected & synced)");
  if (mcpTools.length === 0) {
    lines.push("- (none — user must connect MCP servers first)");
  } else {
    const byServer = new Map<string, McpToolInfo[]>();
    for (const tool of mcpTools) {
      const list = byServer.get(tool.serverId) ?? [];
      list.push(tool);
      byServer.set(tool.serverId, list);
    }
    for (const [serverId, tools] of [...byServer.entries()].sort()) {
      const serverName = tools[0]?.serverName ?? serverId;
      lines.push(`- MCP **${serverName}** (\`${serverId}\`):`);
      for (const tool of tools.sort((a, b) => a.name.localeCompare(b.name))) {
        const params = summarizeMcpInputSchema(tool.inputSchema);
        lines.push(
          `  - \`${mcpToolName(serverId, tool.name)}\` — ${tool.description.slice(0, 80)}; params: ${params}`,
        );
      }
    }
  }
  return lines.join("\n");
}

export function parseSkillBuildUserChoice(content: string): {
  label: string;
  questionId?: string;
} {
  const trimmed = content.trim();
  const withMeta = trimmed.match(/^我选择：(.+?)｜question=([^\s]+)$/);
  if (withMeta) {
    return { label: withMeta[1]!.trim(), questionId: withMeta[2]!.trim() };
  }
  const plain = trimmed.match(/^我选择：(.+)$/);
  if (plain) {
    return { label: plain[1]!.trim() };
  }
  return { label: trimmed };
}

export function buildToolConfirmationQuestions(
  validation: SkillValidationResult,
  mcpTools: McpToolInfo[],
): SkillBuildQuestion[] {
  const questions: SkillBuildQuestion[] = [];

  for (const ref of validation.missingTools) {
    if (!ref.normalized.startsWith("mcp/")) continue;
    const parsed = parseMcpToolName(ref.normalized);
    if (!parsed) continue;
    const serverTools = mcpTools.filter((t) => t.serverId === parsed.serverId);
    const serverName = serverTools[0]?.serverName ?? parsed.serverId;
    const exact = mcpTools.find(
      (t) => mcpToolName(t.serverId, t.name) === ref.normalized,
    );
    const similar = mcpTools.filter(
      (t) =>
        t.name.includes(parsed.toolName) ||
        parsed.toolName.includes(t.name) ||
        t.name.replace(/_/g, "") === parsed.toolName.replace(/_/g, ""),
    );

    if (exact) continue;

    const id = `tool-missing-${ref.normalized}`;
    if (serverTools.length === 0) {
      questions.push({
        id,
        kind: "tool_missing",
        relatedTool: ref.normalized,
        text: `技能引用了 \`${ref.raw}\`。这是指 MCP「${serverName}」（\`${parsed.serverId}\`）的工具「${parsed.toolName}」吗？该 MCP 当前未连接或未同步工具。`,
        options: [
          { id: "yes-configure", label: "是的，我会去连接并同步该 MCP" },
          { id: "change-tool", label: "不是，我要改成其他工具" },
          { id: "remove-tool", label: "先去掉这个工具，继续完善技能" },
        ],
      });
    } else if (similar.length > 0 && similar.length <= 5) {
      questions.push({
        id,
        kind: "tool_confirm",
        relatedTool: ref.normalized,
        text: `未找到 \`${ref.normalized}\`。您指的是以下 MCP 工具之一吗？`,
        options: similar.map((t) => ({
          id: `pick-${t.serverId}-${t.name}`,
          label: `${t.serverName} → ${t.name} (${mcpToolName(t.serverId, t.name)})`,
        })),
      });
    } else {
      questions.push({
        id,
        kind: "tool_missing",
        relatedTool: ref.normalized,
        text: `技能引用了 \`${ref.raw}\`（即 \`${ref.normalized}\`），但当前环境中不存在。请确认 MCP 服务与工具名称是否正确。`,
        options: [
          { id: "fix-name", label: "我会说明正确的工具名称" },
          { id: "configure-mcp", label: "我去配置对应的 MCP" },
        ],
      });
    }
  }

  return questions;
}

/** Drop confirmation prompts once validation passes — avoids stale red UI. */
export function questionsForSkillBuildTurn(
  validation: SkillValidationResult,
  mcpTools: McpToolInfo[],
): SkillBuildQuestion[] {
  if (validation.ok) return [];
  return buildToolConfirmationQuestions(validation, mcpTools);
}

/** LLM sees only the latest user turn; full session history stays in the UI. */
export function messagesForSkillBuildLlm(
  messages: SkillBuildChatMessage[],
): SkillBuildChatMessage[] {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return messages;
  return [last];
}

export async function continueSkillBuildChat(input: {
  messages: SkillBuildChatMessage[];
  draftSkillMd?: string;
  catalog: SkillToolCatalog;
  mcpTools: McpToolInfo[];
}): Promise<SkillBuildTurnResult> {
  const { messages, draftSkillMd, catalog, mcpTools } = input;
  if (messages.length === 0 || messages.at(-1)?.role !== "user") {
    throw new Error("Need at least one user message to continue");
  }

  const registry = await loadProviderRegistry();
  const model = await resolveModel(undefined, registry);
  const router = createLLMRouter(registry);
  const creator = await loadSkillCreatorInstructions();
  const toolsContext = formatToolCatalogForPrompt(catalog, mcpTools);
  const systemBase = `${appendSkillAuthoringLanguageGuidance(creator, messages)}\n\n${toolsContext}`;

  const draft = draftSkillMd?.trim() || undefined;

  let system = systemBase;
  if (draft) {
    system += `\n\n## Current draft SKILL.md\n\n${draft}\n\nRefine this draft using only the user's latest message below. Prior chat turns are not in context — the draft holds earlier requirements. Output the full updated SKILL.md when ready.`;
  }

  const llmMessages = messagesForSkillBuildLlm(messages);
  const lastUser = llmMessages.at(-1);
  let userContent: LLMMessage["content"] = lastUser?.content ?? "";
  if (lastUser?.attachments?.length) {
    const stored = await storeUploadedAttachments(
      `skill-build-${messages.length}`,
      lastUser.attachments,
    );
    userContent = await buildUserContentBlocks(lastUser.content, stored);
  }

  const completion = await router.complete({
    model,
    messages: [
      { role: "system", content: system },
      ...(lastUser
        ? [{ role: "user" as const, content: userContent }]
        : llmMessages.map((m) => ({ role: m.role, content: m.content }))),
    ],
    maxTokens: 8192,
    temperature: 0.4,
  });

  if (completion.finishReason === "error" || !completion.content.trim()) {
    throw new Error("Skill generation failed — check provider configuration");
  }

  const { assistantMessage, skillMd: parsedSkillMd } = splitAssistantBuildResponse(
    completion.content,
  );
  const skillMd = parsedSkillMd ?? draft;
  let validation: SkillValidationResult | undefined;
  let questions: SkillBuildQuestion[] = [];

  if (skillMd) {
    validation = validateSkillDependencies(skillMd, catalog);
    questions = questionsForSkillBuildTurn(validation, mcpTools);
  }

  const readyToSave = Boolean(skillMd && validation?.ok && questions.length === 0);

  return {
    assistantMessage,
    skillMd,
    questions,
    validation,
    readyToSave,
  };
}
