import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getScheduledTasksPath } from "../../config/paths.js";
import {
  createCronJob,
  deleteCronJob,
  getCronJob,
  parseCronCreateInput,
  resetCronJobStore,
  resetDurableCronJobs,
} from "../../cron/job-store.js";
import { validateCronExpression, cronUsesPeakMinute } from "../../cron/validate-cron.js";
import {
  cronCreateHandler,
  cronCreateToolDefinition,
  formatCronCreateResult,
} from "./cron-create.js";
import { toolContext } from "./test-helpers.js";
import { readFile } from "node:fs/promises";

describe("CronCreate tool definition", () => {
  it("exposes Claude-compatible schema fields", () => {
    const props = cronCreateToolDefinition.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(["cron", "durable", "prompt", "recurring"].sort());
    expect(cronCreateToolDefinition.inputSchema.required).toEqual(["cron", "prompt"]);
    expect(cronCreateToolDefinition.inputSchema.additionalProperties).toBe(false);
  });

  it("matches Claude Code description with Kako adaptations", () => {
    expect(cronCreateToolDefinition.description).toContain("Monitor tool");
    expect(cronCreateToolDefinition.description).toContain("Session-only");
    expect(cronCreateToolDefinition.description).toContain("the fleet will");
    expect(cronCreateToolDefinition.description).toContain("this Kako session");
    expect(cronCreateToolDefinition.description).not.toContain(".claude/");
    expect(cronCreateToolDefinition.description).not.toContain("Claude");
    const durableDesc = String(
      cronCreateToolDefinition.inputSchema.properties?.durable?.description ?? "",
    );
    expect(durableDesc).toContain("~/.kako/config/scheduled_tasks.json");
    expect(durableDesc).toContain("this Kako session");
  });
});

describe("parseCronCreateInput", () => {
  afterEach(() => {
    resetCronJobStore();
  });

  it("accepts valid recurring job", () => {
    const parsed = parseCronCreateInput({
      cron: "7 * * * *",
      prompt: "Check deploy status",
    });
    expect(parsed.recurring).toBe(true);
    expect(parsed.durable).toBe(false);
  });

  it("accepts one-shot job", () => {
    const parsed = parseCronCreateInput({
      cron: "30 14 3 7 *",
      prompt: "Remind me",
      recurring: false,
    });
    expect(parsed.recurring).toBe(false);
  });
});

describe("validateCronExpression adversarial", () => {
  it("rejects wrong field count", () => {
    expect(() => validateCronExpression("* * * *")).toThrow(/5 fields/);
    expect(() => validateCronExpression("* * * * * *")).toThrow(/5 fields/);
  });

  it("rejects empty cron", () => {
    expect(() => validateCronExpression("   ")).toThrow(/required/);
  });

  it("rejects invalid characters", () => {
    expect(() => validateCronExpression("bad * * * *")).toThrow(/invalid cron field/);
  });

  it("detects peak minutes", () => {
    expect(cronUsesPeakMinute("0 9 * * *")).toBe(true);
    expect(cronUsesPeakMinute("30 14 1 1 *")).toBe(true);
    expect(cronUsesPeakMinute("7 * * * *")).toBe(false);
  });
});

describe("parseCronCreateInput adversarial", () => {
  it("rejects empty prompt", () => {
    expect(() => parseCronCreateInput({ cron: "0 9 * * *", prompt: "  " })).toThrow(/prompt/);
  });
});

describe("cronCreateHandler", () => {
  let priorHome: string | undefined;

  afterEach(async () => {
    resetCronJobStore();
    await resetDurableCronJobs();
    if (priorHome !== undefined) {
      process.env.KAKO_HOME = priorHome;
    } else {
      delete process.env.KAKO_HOME;
    }
  });

  beforeEach(async () => {
    priorHome = process.env.KAKO_HOME;
    const dir = await mkdtemp(join(tmpdir(), "kako-cron-home-"));
    process.env.KAKO_HOME = dir;
  });

  it("creates session job and returns jobId JSON", async () => {
    const out = await cronCreateHandler(
      { cron: "7 * * * *", prompt: "Ping health" },
      toolContext("/tmp", { sessionId: "sess-cron-1" }),
    );
    const parsed = JSON.parse(String(out)) as { jobId: string; recurring: boolean };
    expect(parsed.jobId).toMatch(/^cron-/);
    expect(parsed.recurring).toBe(true);
    expect(getCronJob("sess-cron-1", parsed.jobId)?.prompt).toBe("Ping health");
  });

  it("persists durable jobs to ~/.kako config path", async () => {
    await cronCreateHandler(
      { cron: "3 9 * * *", prompt: "Daily standup prep", durable: true },
      toolContext("/tmp", { sessionId: "sess-cron-durable" }),
    );
    const raw = await readFile(getScheduledTasksPath(), "utf-8");
    const file = JSON.parse(raw) as { jobs: Array<{ durable: boolean }> };
    expect(file.jobs.some((j) => j.durable)).toBe(true);
  });
});

describe("formatCronCreateResult", () => {
  it("serializes for model consumption", () => {
    const json = formatCronCreateResult({
      jobId: "cron-abc",
      cron: "7 * * * *",
      prompt: "x",
      recurring: true,
      durable: false,
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.parse(json).jobId).toBe("cron-abc");
  });
});

describe("deleteCronJob integration", () => {
  let priorHome: string | undefined;

  beforeEach(async () => {
    priorHome = process.env.KAKO_HOME;
    process.env.KAKO_HOME = await mkdtemp(join(tmpdir(), "kako-cron-del-int-"));
  });

  afterEach(async () => {
    resetCronJobStore();
    await resetDurableCronJobs();
    if (priorHome !== undefined) {
      process.env.KAKO_HOME = priorHome;
    } else {
      delete process.env.KAKO_HOME;
    }
  });

  it("removes session job", async () => {
    const job = createCronJob("sess-del", { cron: "7 * * * *", prompt: "x" });
    expect(await deleteCronJob("sess-del", job.id)).toBe(true);
    expect(getCronJob("sess-del", job.id)).toBeUndefined();
  });
});
