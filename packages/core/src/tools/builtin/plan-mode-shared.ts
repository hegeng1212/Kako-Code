import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getPlansDir } from "../../config/paths.js";

export interface AllowedPromptPermission {
  tool: "Bash";
  prompt: string;
}

export function planFilePathForSession(sessionId: string): string {
  return join(getPlansDir(), `${sessionId}.md`);
}

export async function ensurePlanFile(sessionId: string): Promise<string> {
  const path = planFilePathForSession(sessionId);
  await mkdir(getPlansDir(), { recursive: true });
  try {
    await readFile(path, "utf-8");
  } catch {
    await writeFile(path, "", "utf-8");
  }
  return path;
}

export async function readPlanFile(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf-8")).trim();
  } catch {
    return "";
  }
}

export function parseAllowedPrompts(raw: unknown): AllowedPromptPermission[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AllowedPromptPermission[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const tool = String(row.tool ?? "").trim();
    const prompt = String(row.prompt ?? "").trim();
    if (tool !== "Bash" || !prompt) continue;
    out.push({ tool: "Bash", prompt });
  }
  return out.length ? out : undefined;
}

export function parseExitPlanModeInput(raw: Record<string, unknown>): {
  allowedPrompts?: AllowedPromptPermission[];
} {
  const allowedPrompts = parseAllowedPrompts(raw.allowedPrompts);
  return allowedPrompts ? { allowedPrompts } : {};
}

export function formatAllowedPromptsNote(allowedPrompts?: AllowedPromptPermission[]): string {
  if (!allowedPrompts?.length) return "";
  const lines = allowedPrompts.map((p) => `- ${p.tool}: ${p.prompt}`);
  return `Requested implementation permissions:\n${lines.join("\n")}`;
}
