import { afterEach, describe, expect, it } from "vitest";
import {
  clampWakeupDelaySeconds,
  getScheduledWakeup,
  parseScheduleWakeupInput,
  resetWakeupStore,
  scheduleWakeup,
} from "../../cron/wakeup-store.js";
import { AUTONOMOUS_LOOP_DYNAMIC_SENTINEL } from "../../cron/wakeup-types.js";
import {
  formatScheduleWakeupResult,
  scheduleWakeupHandler,
  scheduleWakeupToolDefinition,
} from "./schedule-wakeup.js";
import { toolContext } from "./test-helpers.js";

describe("ScheduleWakeup tool definition", () => {
  it("exposes Claude-compatible schema fields", () => {
    const props = scheduleWakeupToolDefinition.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(["delaySeconds", "prompt", "reason"].sort());
    expect(scheduleWakeupToolDefinition.inputSchema.required).toEqual([
      "delaySeconds",
      "reason",
      "prompt",
    ]);
    expect(scheduleWakeupToolDefinition.inputSchema.additionalProperties).toBe(false);
  });

  it("matches Claude Code description", () => {
    expect(scheduleWakeupToolDefinition.description).toContain("/loop dynamic mode");
    expect(scheduleWakeupToolDefinition.description).toContain("<<autonomous-loop-dynamic>>");
    expect(scheduleWakeupToolDefinition.description).toContain("Anthropic prompt cache");
    expect(scheduleWakeupToolDefinition.description).toContain("1200s–1800s");
    expect(scheduleWakeupToolDefinition.description).not.toContain("Claude Code");
  });

  it("keeps parameter descriptions aligned with Claude Code", () => {
    expect(scheduleWakeupToolDefinition.inputSchema.properties?.delaySeconds?.description).toContain(
      "[60, 3600]",
    );
    expect(scheduleWakeupToolDefinition.inputSchema.properties?.prompt?.description).toContain(
      "<<autonomous-loop-dynamic>>",
    );
    expect(scheduleWakeupToolDefinition.inputSchema.properties?.reason?.description).toContain(
      "telemetry",
    );
  });
});

describe("parseScheduleWakeupInput", () => {
  afterEach(() => {
    resetWakeupStore();
  });

  it("parses required fields", () => {
    const parsed = parseScheduleWakeupInput({
      delaySeconds: 270,
      prompt: "continue the loop",
      reason: "watching CI run",
    });
    expect(parsed).toEqual({
      delaySeconds: 270,
      prompt: "continue the loop",
      reason: "watching CI run",
    });
  });

  it("accepts autonomous loop sentinel as prompt", () => {
    const parsed = parseScheduleWakeupInput({
      delaySeconds: 1200,
      prompt: AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
      reason: "idle heartbeat",
    });
    expect(parsed.prompt).toBe(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL);
  });

  it("requires prompt and reason", () => {
    expect(() =>
      parseScheduleWakeupInput({ delaySeconds: 120, prompt: "  ", reason: "x" }),
    ).toThrow(/prompt/);
    expect(() =>
      parseScheduleWakeupInput({ delaySeconds: 120, prompt: "x", reason: "  " }),
    ).toThrow(/reason/);
  });
});

describe("clampWakeupDelaySeconds", () => {
  it("clamps to [60, 3600]", () => {
    expect(clampWakeupDelaySeconds(30)).toBe(60);
    expect(clampWakeupDelaySeconds(300)).toBe(300);
    expect(clampWakeupDelaySeconds(5000)).toBe(3600);
    expect(clampWakeupDelaySeconds("bad")).toBe(60);
  });
});

describe("scheduleWakeupHandler", () => {
  afterEach(() => {
    resetWakeupStore();
  });

  it("schedules wakeup and returns JSON result", async () => {
    const json = await scheduleWakeupHandler(
      {
        delaySeconds: 180,
        prompt: "keep looping",
        reason: "waiting on deploy",
      },
      toolContext("/tmp", { sessionId: "sess-wakeup-1" }),
    );
    const parsed = JSON.parse(String(json));
    expect(parsed.wakeupId).toMatch(/^wakeup-/);
    expect(parsed.delaySeconds).toBe(180);
    expect(parsed.prompt).toBe("keep looping");
    expect(parsed.reason).toBe("waiting on deploy");
    expect(parsed.fireAt).toBeTruthy();

    const stored = getScheduledWakeup("sess-wakeup-1");
    expect(stored?.id).toBe(parsed.wakeupId);
    expect(stored?.reason).toBe("waiting on deploy");
  });

  it("replaces prior wakeup for the same session", () => {
    scheduleWakeup("sess-wakeup-2", {
      delaySeconds: 120,
      prompt: "first",
      reason: "first",
    });
    const second = scheduleWakeup("sess-wakeup-2", {
      delaySeconds: 240,
      prompt: "second",
      reason: "second",
    });
    expect(getScheduledWakeup("sess-wakeup-2")?.id).toBe(second.id);
  });
});

describe("formatScheduleWakeupResult", () => {
  it("serializes result", () => {
    const json = formatScheduleWakeupResult({
      wakeupId: "wakeup-abc",
      delaySeconds: 1200,
      fireAt: "2026-07-07T10:00:00.000Z",
      prompt: "loop",
      reason: "idle tick",
    });
    expect(JSON.parse(json).wakeupId).toBe("wakeup-abc");
  });
});
