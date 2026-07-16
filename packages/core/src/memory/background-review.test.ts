import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMemorySettings, saveMemorySettings } from "../config/memory-store.js";
import { createMessage } from "./store.js";
import { loadCuratedEntries } from "./curated-store.js";
import { listPendingMemoryWrites } from "./pending.js";
import { __resetMemoryBudgetForTests } from "./budget.js";
import {
  buildBackgroundReviewDigest,
  hasSubstantiveReviewSignal,
  parseBackgroundReviewOps,
  runBackgroundReview,
} from "./background-review.js";

describe("background-review", () => {
  let home: string;
  let prev: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-br-"));
    prev = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
    await saveMemorySettings(parseMemorySettings({
      backgroundReview: { cooldownSeconds: 0 },
      budget: { enabled: false },
    }));
    await __resetMemoryBudgetForTests();
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prev;
    await rm(home, { recursive: true, force: true });
  });

  it("parses Option A curated add ops", () => {
    const ops = parseBackgroundReviewOps(
      JSON.stringify({
        curated: [{ target: "notes", action: "add", content: "Prefer Option A" }],
        facts: [{ action: "NOOP", reason: "none", content: "x" }],
      }),
    );
    expect(ops?.curated[0]?.content).toBe("Prefer Option A");
  });

  it("builds digest under max chars and skips empty user rows", () => {
    const t = [
      createMessage("user", ""),
      createMessage("system", "protocol only"),
      createMessage("user", "a".repeat(100)),
      createMessage("assistant", "b".repeat(100)),
    ];
    const d = buildBackgroundReviewDigest(t, 80);
    expect(d.length).toBeLessThanOrEqual(80);
    expect(d).not.toContain("protocol only");
  });

  it("substantive signal requires user ask or assistant body", () => {
    expect(hasSubstantiveReviewSignal({ userTurnText: "   " })).toBe(false);
    expect(hasSubstantiveReviewSignal({ userTurnText: "", assistantResponseText: "" })).toBe(false);
    expect(hasSubstantiveReviewSignal({ userTurnText: "hi" })).toBe(true);
    expect(
      hasSubstantiveReviewSignal({
        userTurnText: "",
        assistantResponseText: "bg task follow-up",
      }),
    ).toBe(true);
    expect(hasSubstantiveReviewSignal({ hasUserAttachments: true })).toBe(true);
  });

  it("skips when disabled", async () => {
    const settings = parseMemorySettings({ backgroundReview: { enabled: false } });
    const r = await runBackgroundReview({
      sessionId: "s1",
      transcript: [createMessage("user", "hi")],
      router: { complete: vi.fn() } as never,
      mainModel: "m",
      settings,
      userTurnText: "hi",
    });
    expect(r).toEqual({ ran: false, skippedReason: "disabled" });
  });

  it("skips protocol-only wake with no user ask and no assistant body", async () => {
    const complete = vi.fn();
    const settings = parseMemorySettings({
      backgroundReview: { cooldownSeconds: 0 },
      budget: { enabled: false },
    });
    const r = await runBackgroundReview({
      sessionId: "s1",
      transcript: [
        createMessage("user", "", { metadata: { llmText: "<task-notification/>" } }),
        createMessage("system", "ignored"),
      ],
      router: { complete } as never,
      mainModel: "m",
      settings,
      userTurnText: "",
      assistantResponseText: "",
    });
    expect(r).toEqual({ ran: false, skippedReason: "no_substantive_content" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("runs after async wake when assistant produced body", async () => {
    const settings = parseMemorySettings({
      backgroundReview: { cooldownSeconds: 0, updateCurated: true, extractFacts: false },
      budget: { enabled: false },
    });
    await saveMemorySettings(settings);
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        curated: [{ target: "notes", action: "add", content: "Async Option A done" }],
        facts: [],
      }),
      usage: {},
    }));
    const r = await runBackgroundReview({
      sessionId: "s1",
      transcript: [
        createMessage("user", ""),
        createMessage("assistant", "Async Option A finished"),
      ],
      router: { complete } as never,
      mainModel: "m",
      settings,
      userTurnText: "",
      assistantResponseText: "Async Option A finished",
    });
    expect(r.ran).toBe(true);
    expect(complete).toHaveBeenCalled();
  });

  it("applies curated ops from mock complete", async () => {
    const settings = await (async () => {
      const s = parseMemorySettings({
        backgroundReview: { cooldownSeconds: 0, updateCurated: true, extractFacts: false },
        budget: { enabled: false },
      });
      await saveMemorySettings(s);
      return s;
    })();
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        curated: [{ target: "notes", action: "add", content: "Remember Option B" }],
        facts: [],
      }),
      usage: {},
    }));
    const r = await runBackgroundReview({
      sessionId: "s1",
      transcript: [
        createMessage("user", "please note Option B"),
        createMessage("assistant", "noted"),
      ],
      router: { complete } as never,
      mainModel: "m",
      settings,
      userTurnText: "please note Option B",
    });
    expect(r.ran).toBe(true);
    expect(complete).toHaveBeenCalled();
    const call = complete.mock.calls[0]?.[0] as { messages: unknown[] };
    expect(call.messages).toHaveLength(2);
    expect(await loadCuratedEntries("notes")).toEqual(["Remember Option B"]);
  });

  it("stages when writeApproval enabled", async () => {
    const settings = parseMemorySettings({
      writeApproval: { enabled: true },
      backgroundReview: { cooldownSeconds: 0 },
      budget: { enabled: false },
    });
    await saveMemorySettings(settings);
    await runBackgroundReview({
      sessionId: "s1",
      transcript: [createMessage("user", "x"), createMessage("assistant", "y")],
      router: {
        complete: async () => ({
          content: JSON.stringify({
            curated: [{ target: "user", action: "add", content: "Tag: option-a" }],
            facts: [],
          }),
          usage: {},
        }),
      } as never,
      mainModel: "m",
      settings,
      userTurnText: "x",
    });
    expect(await loadCuratedEntries("user")).toEqual([]);
    expect(await listPendingMemoryWrites()).toHaveLength(1);
  });
});
