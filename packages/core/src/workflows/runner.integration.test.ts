import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchWorkflow } from "./runner.js";
import { loadWorkflowRuns } from "./store.js";
import { readJournalEntries } from "./journal.js";

describe("launchWorkflow integration", () => {
  let home: string;
  let cwd: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-runner-int-"));
    cwd = await mkdtemp(join(tmpdir(), "kako-runner-cwd-"));
    prevHome = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.KAKO_HOME;
    else process.env.KAKO_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  async function waitForRun(sessionId: string, runId: string, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const runs = await loadWorkflowRuns(sessionId);
      const run = runs.find((r) => r.runId === runId);
      if (run && run.status !== "running" && run.status !== "pending") {
        return run;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for workflow ${runId}`);
  }

  it("executes async workflow script and persists result + journal", async () => {
    const sessionId = "sess-async-test";
    const script = `
export const meta = {
  name: 'echo-test',
  description: 'Minimal async workflow test',
  phases: [{ title: 'Run', detail: 'Return payload' }],
};
phase('Run');
log('starting echo workflow');
return { ok: true, message: 'hello from async workflow', count: 42 };
`;
    const launch = await launchWorkflow({
      sessionId,
      cwd,
      name: "echo-test",
      script,
      args: { topic: "test" },
    });

    const run = await waitForRun(sessionId, launch.runId);
    expect(run.status).toBe("completed");
    expect(run.result).toEqual({
      ok: true,
      message: "hello from async workflow",
      count: 42,
    });

    const entries = await readJournalEntries(sessionId, launch.runId);
    expect(entries.some((e) => e.type === "phase" && e.title === "Run")).toBe(true);
    expect(entries.some((e) => e.type === "log" && e.message === "starting echo workflow")).toBe(true);
  });
});
