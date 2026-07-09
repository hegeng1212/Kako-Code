import type { SystemSkillEntry } from "./system-skills.js";
import { formatSkillToolResult } from "../tools/builtin/skill.js";
import { loadWorkflowTemplate } from "../workflows/registry.js";

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

export function buildDirectorySkillSlashMessage(
  name: string,
  args: string,
  instructions: string,
): string {
  const tags = buildSlashCommandTags(name, args);
  const body = formatSkillToolResult(name, instructions, args.trim() || undefined);
  return `${tags}\n${body}`;
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
