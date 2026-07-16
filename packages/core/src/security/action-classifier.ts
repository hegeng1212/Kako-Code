import type { LLMMessage, LLMRouter, PermissionMode, ToolDefinition } from "@kako/shared";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../agents/prompts/security-action-classifier.md",
);

export const STAGE1_USER_SUFFIX =
  "\nErr on the side of blocking. Stage 1 does NOT apply user intent or ALLOW exceptions — stage 2 will handle those. Judge the action by its full effect — what it runs, sends, publishes, or enables — not its surface form. Block if ANY rule could apply. <block> immediately.";

let cachedSystemPrompt: string | null = null;

async function loadSecurityClassifierSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  let prompt = await readFile(PROMPT_PATH, "utf-8");
  if (process.env.USER) {
    prompt = prompt.replaceAll("{user}", process.env.USER);
  }
  cachedSystemPrompt = prompt;
  return cachedSystemPrompt;
}

export interface SecurityBlockVerdict {
  shouldBlock: boolean;
  category?: string;
  reason?: string;
}

const UX_GATE_TOOLS = new Set(["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"]);

export function shouldRunSecurityActionClassifier(options: {
  permissionMode: PermissionMode;
  definition: ToolDefinition;
  toolName?: string;
}): boolean {
  if (options.permissionMode !== "bypassPermissions") return false;
  const name = options.toolName ?? options.definition.name;
  if (UX_GATE_TOOLS.has(name)) return false;
  const security = options.definition.security;
  const readonlySafe =
    security?.readonly === true && !security?.sideEffect && !security?.requiresNetwork;
  return !readonlySafe;
}

/** Compact transcript excerpt for the auto-mode security monitor. */
export function formatSecurityTranscriptExcerpt(options: {
  recentLines: string[];
  toolName: string;
  toolInput: unknown;
}): string {
  const inputJson = JSON.stringify(options.toolInput ?? {}, null, 0);
  const pending = `{"${options.toolName}":${inputJson}}`;
  const body = [...options.recentLines, pending].join("\n");
  return `<transcript>\n${body}\n</transcript>`;
}

export function buildSecurityClassifierMessages(options: {
  transcriptText: string;
  stage: 1 | 2;
  userIdentity?: string;
}): LLMMessage[] {
  const suffix = options.stage === 1 ? STAGE1_USER_SUFFIX : "";
  const identityLine = options.userIdentity
    ? `\n\nUser identity for Stage 2 context: ${options.userIdentity}`
    : "";
  return [
    {
      role: "user",
      content: `${options.transcriptText.trim()}${identityLine}${suffix}`,
    },
  ];
}

export function parseSecurityBlockResponse(content: string): SecurityBlockVerdict {
  const trimmed = content.trim();
  if (!trimmed) {
    return { shouldBlock: true, reason: "Empty security classifier response" };
  }

  const blockMatch = trimmed.match(/<block>\s*(yes|no)\s*<\/block>/i);
  if (!blockMatch) {
    return { shouldBlock: true, reason: "Missing <block> tag in security classifier response" };
  }

  const shouldBlock = blockMatch[1]!.toLowerCase() === "yes";
  const categoryMatch = trimmed.match(/<category>\s*([\s\S]*?)\s*<\/category>/i);
  const reasonMatch = trimmed.match(/<reason>\s*([\s\S]*?)\s*<\/reason>/i);
  const category = categoryMatch?.[1]?.trim();
  const reason = reasonMatch?.[1]?.trim();

  return {
    shouldBlock,
    category: category || undefined,
    reason: reason || undefined,
  };
}

export async function classifySecurityAction(options: {
  router: LLMRouter;
  model: string;
  transcriptText: string;
  userIdentity?: string;
}): Promise<SecurityBlockVerdict> {
  const system = await loadSecurityClassifierSystemPrompt();
  const stage1Messages: LLMMessage[] = [
    { role: "system", content: system },
    ...buildSecurityClassifierMessages({
      transcriptText: options.transcriptText,
      stage: 1,
      userIdentity: options.userIdentity,
    }),
  ];

  const stage1 = await options.router.complete({
    model: options.model,
    messages: stage1Messages,
    temperature: 0,
    maxTokens: 256,
  });
  const stage1Verdict = parseSecurityBlockResponse(stage1.content);
  if (stage1Verdict.shouldBlock) {
    return stage1Verdict;
  }

  const stage2Messages: LLMMessage[] = [
    { role: "system", content: system },
    ...buildSecurityClassifierMessages({
      transcriptText: options.transcriptText,
      stage: 2,
      userIdentity: options.userIdentity,
    }),
  ];

  const stage2 = await options.router.complete({
    model: options.model,
    messages: stage2Messages,
    temperature: 0,
    maxTokens: 256,
  });
  return parseSecurityBlockResponse(stage2.content);
}
