import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillBuildResult } from "@kako/shared";
import { findBundledSkillsDir } from "../config/bundled-assets.js";
import { loadProviderRegistry } from "../config/provider-store.js";
import { createLLMRouter, resolveModel } from "../llm/router.js";
import { parseSkillMd } from "./loader.js";
import { appendSkillAuthoringLanguageGuidance, SKILL_AUTHORING_LANGUAGE_RULES } from "./skill-authoring.js";

const FALLBACK_CREATOR = `You create Agent Skills as SKILL.md files.
Return ONLY the complete SKILL.md with YAML frontmatter (name, description) and actionable markdown body.
No preamble or code fences.

${SKILL_AUTHORING_LANGUAGE_RULES}`;

async function loadSkillCreatorInstructions(): Promise<string> {
  const bundled = await findBundledSkillsDir();
  if (bundled) {
    try {
      const content = await readFile(join(bundled, "skill-creator", "SKILL.md"), "utf-8");
      const parsed = parseSkillMd(content, join(bundled, "skill-creator", "SKILL.md"));
      return parsed.instructions || content;
    } catch {
      // fall through
    }
  }
  return FALLBACK_CREATOR;
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/);
  return match ? match[1]!.trim() : trimmed;
}

export async function buildSkillDraft(userPrompt: string): Promise<SkillBuildResult> {
  const prompt = userPrompt.trim();
  if (!prompt) {
    throw new Error("Describe the skill you want to create");
  }

  const registry = await loadProviderRegistry();
  const model = await resolveModel(undefined, registry);
  const router = createLLMRouter(registry);
  const system = appendSkillAuthoringLanguageGuidance(await loadSkillCreatorInstructions(), prompt);

  const completion = await router.complete({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    maxTokens: 8192,
    temperature: 0.4,
  });

  if (completion.finishReason === "error" || !completion.content.trim()) {
    throw new Error("Skill generation failed — check provider configuration");
  }

  return { skillMd: stripMarkdownFence(completion.content) };
}
