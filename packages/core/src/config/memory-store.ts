import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  DEFAULT_MEMORY_INJECT_CAPS,
  type MemoryInjectCaps,
} from "@kako/shared";
import { getConfigDir } from "./paths.js";

const injectCapsPartialSchema = z
  .object({
    pinsMaxCount: z.number().optional(),
    pinsMaxBytes: z.number().optional(),
    l3FactsMaxTokens: z.number().optional(),
    autoRecallMaxSnippets: z.number().optional(),
    autoRecallMaxTokens: z.number().optional(),
    searchHitSnippetChars: z.number().optional(),
    searchDefaultLimit: z.number().optional(),
    toolResultMaxChars: z.number().optional(),
    toolResultKeepTailLines: z.number().optional(),
    compactReserveTokens: z.number().optional(),
    softCompactRatio: z.number().optional(),
    recentTailTurns: z.number().optional(),
  })
  .strict()
  .optional();

const memorySettingsSchema = z.object({
  autoRecall: z.boolean().default(true),
  injectCaps: injectCapsPartialSchema,
});

export type MemorySettings = z.infer<typeof memorySettingsSchema>;

function memoryConfigPath(): string {
  return join(getConfigDir(), "memory.json");
}

export function parseMemorySettings(input: unknown): MemorySettings {
  return memorySettingsSchema.parse(input ?? {});
}

export async function loadMemorySettings(): Promise<MemorySettings> {
  await mkdir(getConfigDir(), { recursive: true });
  try {
    const text = await readFile(memoryConfigPath(), "utf-8");
    return parseMemorySettings(JSON.parse(text));
  } catch {
    return parseMemorySettings({});
  }
}

export async function saveMemorySettings(settings: MemorySettings): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
  const normalized = parseMemorySettings(settings);
  await writeFile(memoryConfigPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}

export function resolveInjectCaps(settings: MemorySettings): MemoryInjectCaps {
  return {
    ...DEFAULT_MEMORY_INJECT_CAPS,
    ...(settings.injectCaps ?? {}),
  };
}
