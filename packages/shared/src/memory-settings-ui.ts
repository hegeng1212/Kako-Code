import { DEFAULT_MEMORY_INJECT_CAPS } from "./memory.js";

/** Left-nav groups on the Memory settings page. */
export type MemorySettingsGroupId =
  | "autoRecall"
  | "curatedTools"
  | "backgroundReview"
  | "budget"
  | "jobs";

/** UI-facing snapshot of `~/.kako/config/memory.json` (matches web/core DTO). */
export interface MemorySettingsSnapshot {
  version: number;
  autoRecall: { enabled: boolean; maxSnippets?: number; maxTokens?: number };
  writeApproval: { enabled: boolean };
  curated: {
    enabled: boolean;
    notesCharLimit: number;
    userCharLimit: number;
    injectFrozenSnapshot: boolean;
  };
  memoryTool: { enabled: boolean };
  backgroundReview: {
    enabled: boolean;
    model?: string | null;
    providerId?: string | null;
    cooldownSeconds: number;
    maxPerHour: number;
    maxPerDay: number;
    digestMaxChars: number;
    extractFacts: boolean;
    updateCurated: boolean;
  };
  budget: {
    enabled: boolean;
    maxLlmCallsPerHour: number;
    maxLlmCallsPerDay: number;
    maxConcurrentJobs: number;
  };
  jobs: {
    consolidate: { enabled: boolean; model?: string | null; providerId?: string | null; cron?: string };
    curator: { enabled: boolean; model?: string | null; providerId?: string | null; cron?: string };
    dreaming: { enabled: boolean; model?: string | null; providerId?: string | null; cron?: string };
  };
  cli?: { consolidateCommand?: { enabled: boolean } };
  injectCaps?: Record<string, number>;
}

export const MEMORY_UI_K_FACTOR = 1000;

/** Spec ranges for Memory settings UI validation (UI units unless noted). */
export const MEMORY_FIELD_RANGES = {
  maxSnippets: { min: 1, max: 32 },
  /** UI unit: k tokens */
  maxTokensK: { min: 0.1, max: 1024 },
  notesCharLimit: { min: 500, max: 20_000 },
  userCharLimit: { min: 200, max: 10_000 },
  cooldownSeconds: { min: 0, max: 3600 },
  reviewMaxPerHour: { min: 0, max: 200 },
  reviewMaxPerDay: { min: 0, max: 2000 },
  /** UI unit: 千字符 */
  digestMaxCharsK: { min: 1, max: 100 },
  budgetMaxPerHour: { min: 1, max: 500 },
  budgetMaxPerDay: { min: 1, max: 5000 },
  maxConcurrentJobs: { min: 1, max: 8 },
} as const;

export function tokensToUiK(tokens: number): number {
  return roundUiK(tokens / MEMORY_UI_K_FACTOR);
}

export function uiKToTokens(k: number): number {
  return Math.round(k * MEMORY_UI_K_FACTOR);
}

export function charsToUiK(chars: number): number {
  return roundUiK(chars / MEMORY_UI_K_FACTOR);
}

export function uiKToChars(k: number): number {
  return Math.round(k * MEMORY_UI_K_FACTOR);
}

function roundUiK(n: number): number {
  return Math.round(n * 10) / 10;
}

export function isInRange(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max;
}

/** Factory matching core `parseMemorySettings({})` defaults used by restore. */
export function defaultMemorySettingsSnapshot(): MemorySettingsSnapshot {
  return {
    version: 1,
    autoRecall: { enabled: true },
    writeApproval: { enabled: false },
    curated: {
      enabled: true,
      notesCharLimit: 2200,
      userCharLimit: 1375,
      injectFrozenSnapshot: true,
    },
    memoryTool: { enabled: true },
    backgroundReview: {
      enabled: true,
      model: null,
      providerId: null,
      cooldownSeconds: 120,
      maxPerHour: 20,
      maxPerDay: 200,
      digestMaxChars: 12_000,
      extractFacts: true,
      updateCurated: true,
    },
    budget: {
      enabled: true,
      maxLlmCallsPerHour: 40,
      maxLlmCallsPerDay: 300,
      maxConcurrentJobs: 1,
    },
    jobs: {
      consolidate: { enabled: false },
      curator: { enabled: false },
      dreaming: { enabled: false },
    },
    cli: { consolidateCommand: { enabled: true } },
  };
}

/** Display defaults for optional auto-recall caps (injectCaps). */
export const MEMORY_AUTO_RECALL_UI_DEFAULTS = {
  maxSnippets: DEFAULT_MEMORY_INJECT_CAPS.autoRecallMaxSnippets,
  maxTokensK: tokensToUiK(DEFAULT_MEMORY_INJECT_CAPS.autoRecallMaxTokens),
} as const;

/**
 * Replace only the selected group's fields with factory defaults.
 * Other groups and `injectCaps` / `cli` / `version` are preserved.
 */
export function applyMemoryGroupDefaults(
  settings: MemorySettingsSnapshot,
  groupId: MemorySettingsGroupId,
): MemorySettingsSnapshot {
  const defaults = defaultMemorySettingsSnapshot();
  switch (groupId) {
    case "autoRecall":
      return { ...settings, autoRecall: { ...defaults.autoRecall } };
    case "curatedTools":
      return {
        ...settings,
        curated: { ...defaults.curated },
        memoryTool: { ...defaults.memoryTool },
        writeApproval: { ...defaults.writeApproval },
      };
    case "backgroundReview":
      return {
        ...settings,
        backgroundReview: { ...defaults.backgroundReview },
      };
    case "budget":
      return { ...settings, budget: { ...defaults.budget } };
    case "jobs":
      return {
        ...settings,
        jobs: {
          consolidate: {
            ...settings.jobs.consolidate,
            enabled: defaults.jobs.consolidate.enabled,
          },
          curator: {
            ...settings.jobs.curator,
            enabled: defaults.jobs.curator.enabled,
          },
          dreaming: {
            ...settings.jobs.dreaming,
            enabled: defaults.jobs.dreaming.enabled,
          },
        },
      };
    default: {
      const _exhaustive: never = groupId;
      return _exhaustive;
    }
  }
}
