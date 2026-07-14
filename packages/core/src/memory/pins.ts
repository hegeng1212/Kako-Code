import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryInjectCaps, MemoryPin, SessionId } from "@kako/shared";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";
import { getSessionMemoryDir } from "../config/paths.js";
import { randomUUID } from "node:crypto";

export function pinsPath(sessionId: SessionId): string {
  return join(getSessionMemoryDir(sessionId), "pins.json");
}

export async function loadPins(sessionId: SessionId): Promise<MemoryPin[]> {
  try {
    const raw = await readFile(pinsPath(sessionId), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMemoryPin);
  } catch {
    return [];
  }
}

function isMemoryPin(value: unknown): value is MemoryPin {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.content === "string" &&
    typeof p.createdAt === "string"
  );
}

export async function savePins(sessionId: SessionId, pins: MemoryPin[]): Promise<void> {
  await mkdir(getSessionMemoryDir(sessionId), { recursive: true });
  await writeFile(pinsPath(sessionId), `${JSON.stringify(pins, null, 2)}\n`, "utf-8");
}

export function createPin(content: string, source?: string): MemoryPin {
  return {
    id: `pin-${randomUUID().slice(0, 8)}`,
    content: content.trim(),
    createdAt: new Date().toISOString(),
    ...(source ? { source } : {}),
  };
}

/** Apply count + bytes caps for reinjection. */
export function selectPinsForInject(
  pins: MemoryPin[],
  caps: MemoryInjectCaps = DEFAULT_MEMORY_INJECT_CAPS,
): MemoryPin[] {
  const selected: MemoryPin[] = [];
  let bytes = 0;
  for (const pin of pins) {
    if (selected.length >= caps.pinsMaxCount) break;
    const size = Buffer.byteLength(pin.content, "utf-8");
    if (bytes + size > caps.pinsMaxBytes) break;
    selected.push(pin);
    bytes += size;
  }
  return selected;
}

export function formatPinsForPrompt(pins: MemoryPin[]): string {
  if (!pins.length) return "";
  const lines = pins.map((p) => `- ${p.content}`);
  return `## Session Pins\n\n${lines.join("\n")}`;
}

export async function upsertPin(
  sessionId: SessionId,
  content: string,
  source?: string,
): Promise<MemoryPin[]> {
  const pins = await loadPins(sessionId);
  const normalized = content.trim();
  if (!normalized) return pins;
  const existing = pins.find((p) => p.content === normalized);
  if (existing) return pins;
  pins.push(createPin(normalized, source));
  await savePins(sessionId, pins);
  return pins;
}
