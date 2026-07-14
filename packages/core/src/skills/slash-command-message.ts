import type { SystemSkillEntry } from "./system-skills.js";
import type { LLMContentBlock } from "@kako/shared";
import { formatSkillToolResult } from "../tools/builtin/skill.js";
import { loadWorkflowTemplate } from "../workflows/registry.js";

export const INIT_SLASH_CORE_PROMPT = `Please analyze this codebase and create a KAKO.md file, which will be given to future Kako sessions operating in this repository.

If KAKO.md already exists at the repository root (or was just created in this session — it may appear in the harness system-reminder context):
- Do not re-scan the entire codebase or rewrite the file from scratch.
- Tell the user that KAKO.md has already been initialized in this repository.
- Briefly summarize what it already covers (e.g. architecture overview, common commands, testing instructions).
- Offer to improve or extend it; only then read the repo and update the file if the user wants changes.

If KAKO.md does not exist yet, analyze the codebase and create it.

What to add:
1. Commands that will be commonly used, such as how to build, lint, and run tests. Include the necessary commands to develop in this codebase, such as how to run a single test.
2. High-level code architecture and structure so that future instances can be productive more quickly. Focus on the "big picture" architecture that requires reading multiple files to understand.

Usage notes:
- When you make the initial KAKO.md, do not repeat yourself and do not include obvious instructions like "Provide helpful error messages to users", "Write unit tests for all new utilities", "Never include sensitive information (API keys, tokens) in code or commits".
- Avoid listing every component or file structure that can be easily discovered.
- Don't include generic development practices.
- If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include the important parts.
- If there is a README.md, make sure to include the important parts.
- Do not make up information such as "Common Development Tasks", "Tips for Development", "Support and Documentation" unless this is expressly included in other files that you read.
- Be sure to prefix the file with the following text:

\`\`\`
# KAKO.md

This file provides guidance to Kako when working with code in this repository.
\`\`\``;

export type SlashUserContent =
  | { mode: "text"; text: string }
  | { mode: "blocks"; blocks: LLMContentBlock[] };

/** Bare `init` / `init <args>` typed without a leading slash — same harness entry as `/init`. */
export function parseBareInitCommand(line: string): { args: string; displayText: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = /^init(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  return {
    args: match[1]?.trim() ?? "",
    displayText: trimmed,
  };
}

export function buildSlashCommandTags(name: string, args: string): string {
  const lines = [
    `<command-message>${name}</command-message>`,
    `<command-name>/${name}</command-name>`,
  ];
  if (args.trim()) {
    lines.push(`<command-args>${args.trim()}</command-args>`);
  }
  return `${lines.join("\n")}\n`;
}

const DEEP_RESEARCH_PHASES = [
  "Scope: Decompose question (from args) into 5 search angles",
  "Search: 5 parallel WebSearch agents, one per angle",
  "Fetch: URL-dedup, fetch top 15 sources, extract falsifiable claims",
  "Verify: 3-vote adversarial verification per claim (need 2/3 refutes to kill)",
  "Synthesize: Merge semantic dupes, rank by confidence, cite sources",
];

export async function buildDynamicWorkflowSlashMessage(
  entry: SystemSkillEntry,
  args: string,
  cwd?: string,
): Promise<string> {
  const tags = buildSlashCommandTags(entry.name, args);
  const trimmedArgs = args.trim();
  const template = await loadWorkflowTemplate(entry.name, cwd).catch(() => null);
  const description = template?.meta.description ?? entry.description;
  const whenToUse = template?.meta.whenToUse;
  const phases = (template?.meta.phases ?? []).map((p) =>
    `- ${p.title}${p.detail ? `: ${p.detail}` : ""}`,
  );
  const phaseBlock = phases.length
    ? phases.join("\n")
    : DEEP_RESEARCH_PHASES.map((p) => `- ${p}`).join("\n");

  const invokeArgs = trimmedArgs
    ? `, args: ${JSON.stringify(trimmedArgs)}`
    : "";
  const invokeLine = `Invoke: Workflow({ name: "${entry.name}"${invokeArgs} })`;

  const guide = [
    `Run the "${entry.name}" workflow.`,
    "",
    description,
    "",
    whenToUse ??
      "When the user wants a deep, multi-source, fact-checked research report on any topic. BEFORE invoking, check if the question is specific enough to research directly — if underspecified (e.g., \"what car to buy\" without budget/use-case/region), ask 2-3 clarifying questions to narrow scope. Then pass the refined question as args, weaving the answers in.",
    "",
    "Phases:",
    phaseBlock,
    "",
    invokeLine,
  ].join("\n");

  return `${tags}\n${guide}`;
}

export function buildInitSlashContentBlocks(args: string): LLMContentBlock[] {
  return [
    { type: "text", text: buildSlashCommandTags("init", args.trim()) },
    { type: "text", text: INIT_SLASH_CORE_PROMPT },
  ];
}

export function buildDirectorySkillSlashMessage(
  name: string,
  args: string,
  instructions: string,
): string {
  const tags = buildSlashCommandTags(name, args);
  const body = formatSkillToolResult(name, instructions, args.trim() || undefined);
  return `${tags}\n${body}`;
}

export async function resolveSkillSlashUserContent(
  name: string,
  args: string,
  handler: "skill" | "dynamic-workflow",
  cwd: string,
): Promise<SlashUserContent> {
  const text = await resolveSkillSlashLlmText(name, args, handler, cwd);
  return { mode: "text", text };
}

export async function resolveSkillSlashLlmText(
  name: string,
  args: string,
  handler: "skill" | "dynamic-workflow",
  cwd: string,
): Promise<string> {
  const { getSystemSkillEntry } = await import("./system-skills.js");
  const { loadSkill } = await import("./loader.js");

  if (handler === "dynamic-workflow") {
    const entry = getSystemSkillEntry(name);
    if (!entry) throw new Error(`Unknown dynamic workflow skill: ${name}`);
    return buildDynamicWorkflowSlashMessage(entry, args, cwd);
  }

  const loaded = await loadSkill(name, cwd);
  return buildDirectorySkillSlashMessage(name, args, loaded.instructions);
}
