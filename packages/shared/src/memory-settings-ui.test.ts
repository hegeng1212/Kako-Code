import { describe, expect, it } from "vitest";
import {
  MEMORY_AUTO_RECALL_UI_DEFAULTS,
  MEMORY_FIELD_RANGES,
  applyMemoryGroupDefaults,
  charsToUiK,
  defaultMemorySettingsSnapshot,
  isInRange,
  tokensToUiK,
  uiKToChars,
  uiKToTokens,
} from "./memory-settings-ui.js";

describe("memory settings UI units", () => {
  it("converts tokens ↔ k with one decimal", () => {
    expect(tokensToUiK(600)).toBe(0.6);
    expect(uiKToTokens(0.6)).toBe(600);
    expect(uiKToTokens(1024)).toBe(1_024_000);
  });

  it("converts digest chars ↔ 千字符", () => {
    expect(charsToUiK(12_000)).toBe(12);
    expect(uiKToChars(12)).toBe(12_000);
  });

  it("rejects out-of-range maxTokensK like 0.01", () => {
    expect(isInRange(0.01, MEMORY_FIELD_RANGES.maxTokensK.min, MEMORY_FIELD_RANGES.maxTokensK.max)).toBe(
      false,
    );
    expect(isInRange(1, MEMORY_FIELD_RANGES.maxTokensK.min, MEMORY_FIELD_RANGES.maxTokensK.max)).toBe(true);
  });

  it("exposes auto-recall display defaults from inject caps", () => {
    expect(MEMORY_AUTO_RECALL_UI_DEFAULTS.maxSnippets).toBe(4);
    expect(MEMORY_AUTO_RECALL_UI_DEFAULTS.maxTokensK).toBe(0.6);
  });
});

describe("applyMemoryGroupDefaults", () => {
  it("restores only autoRecall without touching budget", () => {
    const base = defaultMemorySettingsSnapshot();
    const dirty = {
      ...base,
      autoRecall: { enabled: false, maxSnippets: 1, maxTokens: 1 },
      budget: { ...base.budget, maxLlmCallsPerHour: 99 },
    };
    const next = applyMemoryGroupDefaults(dirty, "autoRecall");
    expect(next.autoRecall).toEqual({ enabled: true });
    expect(next.budget.maxLlmCallsPerHour).toBe(99);
  });

  it("restores jobs enabled flags to off only", () => {
    const base = defaultMemorySettingsSnapshot();
    const dirty = {
      ...base,
      jobs: {
        consolidate: { enabled: true, cron: "0 1 * * *" },
        curator: { enabled: true },
        dreaming: { enabled: true },
      },
    };
    const next = applyMemoryGroupDefaults(dirty, "jobs");
    expect(next.jobs.consolidate.enabled).toBe(false);
    expect(next.jobs.consolidate.cron).toBe("0 1 * * *");
    expect(next.jobs.curator.enabled).toBe(false);
    expect(next.jobs.dreaming.enabled).toBe(false);
  });
});
