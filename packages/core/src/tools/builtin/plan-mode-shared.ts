import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getPlansDir } from "../../config/paths.js";
import { sessionManager } from "../../session/manager.js";
import { generatePlanFileBase } from "./plan-file-name.js";

export interface AllowedPromptPermission {
  tool: "Bash";
  prompt: string;
}

/** Legacy path before friendly plan names (sessionId.md). */
export function legacyPlanFilePathForSession(sessionId: string): string {
  return join(getPlansDir(), `${sessionId}.md`);
}

/** @deprecated Use resolvePlanFileForSession */
export const planFilePathForSession = legacyPlanFilePathForSession;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createPlanFile(sessionId: string, topicHint?: string): Promise<string> {
  await mkdir(getPlansDir(), { recursive: true });
  const base = generatePlanFileBase(topicHint);
  let path = join(getPlansDir(), `${base}.md`);
  let suffix = 2;
  while (await fileExists(path)) {
    path = join(getPlansDir(), `${base}-${suffix}.md`);
    suffix++;
  }
  await writeFile(path, "", "utf-8");
  try {
    await sessionManager.updateSession(sessionId, { planFilePath: path });
  } catch {
    // Best-effort persistence when session meta is unavailable (e.g. isolated tests).
  }
  return path;
}

/** Resolve the plan file for a session, creating and persisting one when needed. */
export async function resolvePlanFileForSession(
  sessionId: string,
  options?: { topicHint?: string },
): Promise<string> {
  const meta = await sessionManager.getSessionMeta(sessionId);
  if (meta?.planFilePath && (await fileExists(meta.planFilePath))) {
    return meta.planFilePath;
  }

  const legacy = legacyPlanFilePathForSession(sessionId);
  if (await fileExists(legacy)) {
    try {
      await sessionManager.updateSession(sessionId, { planFilePath: legacy });
    } catch {
      // Best-effort migration.
    }
    return legacy;
  }

  return createPlanFile(sessionId, options?.topicHint ?? meta?.title);
}

export async function ensurePlanFile(
  sessionId: string,
  topicHint?: string,
): Promise<string> {
  const path = await resolvePlanFileForSession(sessionId, { topicHint });
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
