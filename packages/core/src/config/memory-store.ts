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

const enabledBlock = z.object({ enabled: z.boolean().default(true) });

const modelSelect = z.object({
  model: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
});

const autoRecallSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxSnippets: z.number().optional(),
    maxTokens: z.number().optional(),
  })
  .default({ enabled: true });

const writeApprovalSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .default({ enabled: false });

const curatedSchema = z
  .object({
    enabled: z.boolean().default(true),
    notesCharLimit: z.number().default(2200),
    userCharLimit: z.number().default(1375),
    injectFrozenSnapshot: z.boolean().default(true),
  })
  .default({});

const memoryToolSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .default({ enabled: true });

const backgroundReviewSchema = z
  .object({
    enabled: z.boolean().default(true),
    model: z.string().nullable().optional(),
    providerId: z.string().nullable().optional(),
    cooldownSeconds: z.number().default(120),
    maxPerHour: z.number().default(20),
    maxPerDay: z.number().default(200),
    digestMaxChars: z.number().default(12_000),
    extractFacts: z.boolean().default(true),
    updateCurated: z.boolean().default(true),
  })
  .default({});

const budgetSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxLlmCallsPerHour: z.number().default(40),
    maxLlmCallsPerDay: z.number().default(300),
    maxConcurrentJobs: z.number().default(1),
  })
  .default({});

const consolidateJobSchema = z
  .object({
    enabled: z.boolean().default(false),
    model: z.string().nullable().optional(),
    providerId: z.string().nullable().optional(),
    cron: z.string().default("0 3 * * *"),
    maxSessionsPerRun: z.number().default(20),
    onlyIfDirty: z.boolean().default(true),
    writeL2: z.boolean().default(true),
    extractFacts: z.boolean().default(true),
  })
  .default({ enabled: false });

const curatorJobSchema = z
  .object({
    enabled: z.boolean().default(false),
    model: z.string().nullable().optional(),
    providerId: z.string().nullable().optional(),
    cron: z.string().default("0 4 * * *"),
    factMaxAgeDays: z.number().default(90),
    minConfidence: z.number().default(0.3),
    promoteEpisodes: z.boolean().default(true),
    llmContradictionCheck: z.boolean().default(false),
  })
  .default({ enabled: false });

const dreamingJobSchema = z
  .object({
    enabled: z.boolean().default(false),
    model: z.string().nullable().optional(),
    providerId: z.string().nullable().optional(),
    cron: z.string().default("0 5 * * *"),
    maxTokensPerRun: z.number().default(8000),
    reorganizeCurated: z.boolean().default(true),
    rebuildFts: z.boolean().default(false),
  })
  .default({ enabled: false });

const jobsSchema = z
  .object({
    consolidate: consolidateJobSchema,
    curator: curatorJobSchema,
    dreaming: dreamingJobSchema,
  })
  .default({});

const cliSchema = z
  .object({
    consolidateCommand: enabledBlock.default({ enabled: true }),
  })
  .default({});

const memorySettingsObjectSchema = z.object({
  version: z.number().default(1),
  autoRecall: autoRecallSchema,
  writeApproval: writeApprovalSchema,
  curated: curatedSchema,
  memoryTool: memoryToolSchema,
  backgroundReview: backgroundReviewSchema,
  budget: budgetSchema,
  jobs: jobsSchema,
  cli: cliSchema,
  injectCaps: injectCapsPartialSchema,
});

export type MemorySettings = z.infer<typeof memorySettingsObjectSchema>;

function memoryConfigPath(): string {
  return join(getConfigDir(), "memory.json");
}

/** Normalize legacy flat `autoRecall: boolean` into nested shape. */
function normalizeLegacyInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input ?? {};
  const raw = { ...(input as Record<string, unknown>) };
  if (typeof raw.autoRecall === "boolean") {
    raw.autoRecall = { enabled: raw.autoRecall };
  }
  return raw;
}

export function parseMemorySettings(input: unknown): MemorySettings {
  return memorySettingsObjectSchema.parse(normalizeLegacyInput(input));
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
  const caps = {
    ...DEFAULT_MEMORY_INJECT_CAPS,
    ...(settings.injectCaps ?? {}),
  };
  if (settings.autoRecall.maxSnippets !== undefined) {
    caps.autoRecallMaxSnippets = settings.autoRecall.maxSnippets;
  }
  if (settings.autoRecall.maxTokens !== undefined) {
    caps.autoRecallMaxTokens = settings.autoRecall.maxTokens;
  }
  return caps;
}

export function isAutoRecallEnabled(settings: MemorySettings): boolean {
  return settings.autoRecall.enabled !== false;
}

export function isCuratedEnabled(settings: MemorySettings): boolean {
  return settings.curated.enabled !== false;
}

export function isMemoryToolEnabled(settings: MemorySettings): boolean {
  return settings.memoryTool.enabled !== false && isCuratedEnabled(settings);
}

export function isBackgroundReviewEnabled(settings: MemorySettings): boolean {
  return settings.backgroundReview.enabled !== false;
}

export function isWriteApprovalEnabled(settings: MemorySettings): boolean {
  return settings.writeApproval.enabled === true;
}
