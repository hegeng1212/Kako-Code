import { afterEach, describe, expect, it } from "vitest";
import { createCronJob, resetCronJobStore } from "../../cron/job-store.js";
import {
  cronListHandler,
  cronListToolDefinition,
  formatCronListResult,
} from "./cron-list.js";
import { toolContext } from "./test-helpers.js";

describe("CronList tool definition", () => {
  it("matches Claude Code schema and description", () => {
    expect(cronListToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(cronListToolDefinition.inputSchema.properties).toEqual({});
    expect(cronListToolDefinition.description).toBe(
      "List all cron jobs scheduled via CronCreate in this session.",
    );
  });
});

describe("cronListHandler", () => {
  afterEach(() => {
    resetCronJobStore();
  });

  it("returns empty list when no jobs", async () => {
    const out = await cronListHandler({}, toolContext("/tmp", { sessionId: "sess-empty" }));
    expect(JSON.parse(String(out))).toEqual({ jobs: [] });
  });

  it("lists jobs for the current session only", async () => {
    const job = createCronJob("sess-a", { cron: "7 * * * *", prompt: "Ping" });
    createCronJob("sess-b", { cron: "3 9 * * *", prompt: "Other" });

    const out = await cronListHandler({}, toolContext("/tmp", { sessionId: "sess-a" }));
    const parsed = JSON.parse(String(out)) as { jobs: Array<{ id: string; prompt: string }> };
    expect(parsed.jobs).toHaveLength(1);
    expect(parsed.jobs[0]?.id).toBe(job.id);
    expect(parsed.jobs[0]?.prompt).toBe("Ping");
  });
});

describe("formatCronListResult", () => {
  it("serializes job fields without sessionId", () => {
    const json = formatCronListResult([
      {
        id: "cron-abc",
        sessionId: "sess-x",
        cron: "7 * * * *",
        prompt: "remind",
        recurring: false,
        durable: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-08T00:00:00.000Z",
      },
    ]);
    const parsed = JSON.parse(json) as { jobs: Array<Record<string, unknown>> };
    expect(parsed.jobs[0]).toMatchObject({
      id: "cron-abc",
      cron: "7 * * * *",
      prompt: "remind",
      recurring: false,
      durable: true,
    });
    expect(parsed.jobs[0]).not.toHaveProperty("sessionId");
  });
});
