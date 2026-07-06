import type { SkillBuildChatMessage } from "@kako/shared";

/** How to document MCP tool parameters inside SKILL.md body text. */
export const SKILL_MCP_PARAM_DOC_RULES = `## MCP tool parameter documentation
When a workflow step calls an MCP tool, document its parameters using exact names from the tool schema in Available Tools.
- Parameters listed in the schema \`required\` array **must** be labeled **必填** (Chinese skill text) or **required** (English skill text). Never describe them as optional.
- Parameters not in \`required\` should be labeled **可选** or **optional**.
- You may note that \`AskUserQuestion\` collects missing values at runtime, but schema-required fields must still be marked 必填/required in the skill.`;

/** Shared language rules for SKILL.md authoring prompts. */
export const SKILL_AUTHORING_LANGUAGE_RULES = `## Language rules
- **English only (required keys & identifiers):** YAML frontmatter keys (\`name\`, \`description\`), the \`name\` field value (kebab-case identifier), built-in tool names (\`Read\`, \`Write\`, \`Bash\`, …), MCP tool paths (\`mcp/server-id/tool_name\`), and MCP parameter names exactly as defined in the tool schema.
- **Match the user's language for all other text:** frontmatter \`description\` prose, markdown headings, workflow steps, examples, and your chat replies — use the same language the user writes in. Do not mix languages in narrative text unless the user does.`;

export type SkillAuthoringUserLanguage = "zh" | "en" | "mixed";

export function collectUserAuthoringText(
  source: string | Pick<SkillBuildChatMessage, "role" | "content">[],
): string {
  if (typeof source === "string") return source;
  return source
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

export function inferUserAuthoringLanguage(
  source: string | Pick<SkillBuildChatMessage, "role" | "content">[],
): SkillAuthoringUserLanguage {
  const text = collectUserAuthoringText(source);
  if (!text.trim()) return "en";

  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latinWordCount = (text.match(/[a-zA-Z]+/g) ?? []).length;

  if (cjkCount === 0) return "en";
  if (latinWordCount === 0 || cjkCount >= latinWordCount) return "zh";
  return "mixed";
}

export function formatSkillAuthoringLocaleHint(
  source: string | Pick<SkillBuildChatMessage, "role" | "content">[],
): string {
  const lang = inferUserAuthoringLanguage(source);

  if (lang === "zh") {
    return `## User language
The user writes in **Chinese**. Write the skill \`description\` and all markdown body text in Chinese. Keep YAML keys, tool names, and MCP parameter names in English as required.`;
  }

  if (lang === "en") {
    return `## User language
The user writes in **English**. Write the skill \`description\` and markdown body in English. Keep YAML keys and tool identifiers in English.`;
  }

  return `## User language
Follow the language the user primarily uses in their messages for skill \`description\` and body text. Keep YAML keys, tool names, and MCP parameter names in English.`;
}

export function appendSkillAuthoringLanguageGuidance(
  baseInstructions: string,
  source: string | Pick<SkillBuildChatMessage, "role" | "content">[],
): string {
  return `${baseInstructions.trim()}\n\n${SKILL_AUTHORING_LANGUAGE_RULES}\n\n${SKILL_MCP_PARAM_DOC_RULES}\n\n${formatSkillAuthoringLocaleHint(source)}`;
}
