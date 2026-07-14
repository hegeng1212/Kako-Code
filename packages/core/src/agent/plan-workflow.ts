import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findBundledAssetDir } from "../config/bundled-assets.js";

let cachedPrompt: string | null = null;

async function resolvePlanWorkflowPromptPath(): Promise<string> {
  const agentsDir = await findBundledAssetDir("agents");
  if (!agentsDir) {
    throw new Error("plan-workflow.md: bundled agents directory not found");
  }
  return join(agentsDir, "prompts", "plan-workflow.md");
}

async function loadPlanWorkflowTemplate(): Promise<string> {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = await readFile(await resolvePlanWorkflowPromptPath(), "utf-8");
  return cachedPrompt;
}

export async function formatPlanWorkflowReminder(planFilePath: string): Promise<string> {
  const template = await loadPlanWorkflowTemplate();
  const body = template.replaceAll("{planFilePath}", planFilePath);
  return `\n<system-reminder>\n${body.trim()}\n</system-reminder>`;
}
