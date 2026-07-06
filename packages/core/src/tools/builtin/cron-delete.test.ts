import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCronJob, resetCronJobStore, resetDurableCronJobs } from "../../cron/job-store.js";
import {
  cronDeleteHandler,
  cronDeleteToolDefinition,
  parseCronDeleteInput,
} from "./cron-delete.js";
import { toolContext } from "./test-helpers.js";

describe("CronDelete tool definition", () => {
  it("matches Claude Code schema and description", () => {
    expect(cronDeleteToolDefinition.inputSchema.required).toEqual(["id"]);
    expect(cronDeleteToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(cronDeleteToolDefinition.inputSchema.properties?.id).toMatchObject({
      type: "string",
      description: "Job ID returned by CronCreate.",
    });
    expect(cronDeleteToolDefinition.description).toBe(
      "Cancel a cron job previously scheduled with CronCreate. Removes it from the in-memory session store.",
    );
  });
});

describe("cronDeleteHandler", () => {
  let priorHome: string | undefined;

  beforeEach(async () => {
    priorHome = process.env.KAKO_HOME;
    process.env.KAKO_HOME = await mkdtemp(join(tmpdir(), "kako-cron-del-"));
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

  it("deletes existing job", async () => {
    const job = createCronJob("sess-x", { cron: "7 * * * *", prompt: "remind" });
    const out = await cronDeleteHandler({ id: job.id }, toolContext("/tmp", { sessionId: "sess-x" }));
    const parsed = JSON.parse(String(out)) as { deleted: boolean };
    expect(parsed.deleted).toBe(true);
  });

  it("returns deleted false for unknown job", async () => {
    const out = await cronDeleteHandler(
      { id: "cron-missing" },
      toolContext("/tmp", { sessionId: "sess-x" }),
    );
    expect(JSON.parse(String(out)).deleted).toBe(false);
  });
});

describe("parseCronDeleteInput adversarial", () => {
  it("rejects empty id", () => {
    expect(() => parseCronDeleteInput({ id: "  " })).toThrow(/id/);
  });

  it("accepts legacy jobId alias", () => {
    expect(parseCronDeleteInput({ jobId: "cron-abc" })).toBe("cron-abc");
  });
});
