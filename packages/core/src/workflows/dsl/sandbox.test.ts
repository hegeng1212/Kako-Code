import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginTurnBudget, clearTurnBudget } from "../budget.js";
import { executeWorkflowScript } from "./sandbox.js";

vi.mock("../workflow-agent.js", () => ({
  runWorkflowAgent: vi.fn(async (prompt: string) => `result:${prompt}`),
}));

describe("executeWorkflowScript DSL globals", () => {
  let dir: string;
  const priorHome = process.env.KAKO_HOME;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kako-sandbox-"));
    process.env.KAKO_HOME = dir;
    clearTurnBudget("sess-sandbox");
  });

  afterEach(async () => {
    clearTurnBudget("sess-sandbox");
    if (priorHome === undefined) delete process.env.KAKO_HOME;
    else process.env.KAKO_HOME = priorHome;
    await rm(dir, { recursive: true, force: true });
  });

  async function writeScript(name: string, body: string): Promise<string> {
    const path = join(dir, name);
    await writeFile(
      path,
      `export const meta = { name: 'test', description: 'test harness' };\n${body}\n`,
      "utf-8",
    );
    return path;
  }

  it("exposes budget global tied to turn pool", async () => {
    beginTurnBudget("sess-sandbox", "+1000");
    const scriptPath = await writeScript(
      "budget.js",
      `
      if (budget.total !== 1000) throw new Error('bad total: ' + budget.total);
      budget.spent();
      return { remaining: budget.remaining() };
      `,
    );
    const result = await executeWorkflowScript({
      scriptPath,
      args: {},
      ctx: { sessionId: "sess-sandbox", cwd: dir, runId: "wf_test" },
    });
    expect(result).toEqual({ remaining: 1000 });
  });

  it("rejects workflow() nesting beyond one level", async () => {
    const leafPath = await writeScript("leaf.js", "return 1;");
    const childPath = await writeScript(
      "child-nest.js",
      `return workflow({ scriptPath: ${JSON.stringify(leafPath)} });`,
    );
    const parentPath = await writeScript(
      "parent-nest.js",
      `return workflow({ scriptPath: ${JSON.stringify(childPath)} });`,
    );
    await expect(
      executeWorkflowScript({
        scriptPath: parentPath,
        args: {},
        ctx: { sessionId: "sess-sandbox", cwd: dir, runId: "wf_parent" },
      }),
    ).rejects.toThrow(/nesting is limited to one level/i);
  });

  it("runs nested workflow inline under ▸ group", async () => {
    const childPath = await writeScript(
      "child.js",
      `
      phase('ChildPhase');
      return await agent('child prompt', { label: 'child-agent', phase: 'ChildPhase' });
      `,
    );
    const parentPath = await writeScript(
      "parent.js",
      `
      return await workflow({ scriptPath: ${JSON.stringify(childPath)} }, { q: 1 });
      `,
    );
    const result = await executeWorkflowScript({
      scriptPath: parentPath,
      args: {},
      ctx: { sessionId: "sess-sandbox", cwd: dir, runId: "wf_nested" },
    });
    expect(result).toBe("result:child prompt");
  });

  it("blocks Date.now() in workflow scripts", async () => {
    const scriptPath = await writeScript(
      "date.js",
      "Date.now(); return true;",
    );
    await expect(
      executeWorkflowScript({
        scriptPath,
        args: {},
        ctx: { sessionId: "sess-sandbox", cwd: dir, runId: "wf_date" },
      }),
    ).rejects.toThrow(/Date\.now\(\) is unavailable/i);
  });

  it("strips deep-research style meta blocks without trailing semicolon", async () => {
    const scriptPath = join(dir, "deep-research-like.js");
    await writeFile(
      scriptPath,
      `export const meta = {
  name: 'deep-research',
  description: 'Deep research harness',
  phases: [{"title":"Scope","detail":"plan"}],
}

return await agent('ping', { label: 'ping' });
`,
      "utf-8",
    );
    const result = await executeWorkflowScript({
      scriptPath,
      args: "test question",
      ctx: { sessionId: "sess-sandbox", cwd: dir, runId: "wf_deep" },
    });
    expect(result).toBe("result:ping");
  });

  it("keeps agentsDone ≤ agentsTotal when two top-level workflows run concurrently", async () => {
    const { runWorkflowAgent } = await import("../workflow-agent.js");
    let aStarted = 0;
    let releaseB!: () => void;
    const bGate = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    vi.mocked(runWorkflowAgent).mockImplementation(async (prompt, opts, ctx) => {
      const label = opts.label ?? "agent";
      await ctx.onAgentStart?.(label, opts.phase);
      if (String(prompt).startsWith("slow-")) {
        aStarted += 1;
        if (aStarted === 3) releaseB();
        await new Promise((r) => setTimeout(r, 40));
      } else {
        await new Promise((r) => setTimeout(r, 1));
      }
      await ctx.onAgentEnd?.({
        label,
        phase: opts.phase,
        model: "mock",
        tokens: 1,
        durationMs: 1,
        status: "success",
        output: "ok",
      });
      return "ok";
    });

    const applyMax = (
      store: { total: number; done: number },
      patch: { agentsTotal?: number; agentsDone?: number },
    ) => {
      if (typeof patch.agentsTotal === "number") {
        store.total = Math.max(store.total, patch.agentsTotal);
      }
      if (typeof patch.agentsDone === "number") {
        store.done = Math.max(store.done, patch.agentsDone);
      }
    };

    const storeA = { total: 0, done: 0 };
    const storeB = { total: 0, done: 0 };

    const pathA = await writeScript(
      "concurrent-a.js",
      `
      await Promise.all([
        agent('slow-1', { label: 'a1' }),
        agent('slow-2', { label: 'a2' }),
        agent('slow-3', { label: 'a3' }),
      ]);
      return 'A';
      `,
    );
    const pathB = await writeScript(
      "concurrent-b.js",
      `
      for (let i = 0; i < 10; i++) {
        await agent('fast-' + i, { label: 'b' + i });
      }
      return 'B';
      `,
    );

    const runA = executeWorkflowScript({
      scriptPath: pathA,
      args: {},
      ctx: {
        sessionId: "sess-sandbox",
        cwd: dir,
        runId: "wf_a",
        onRunStats: (patch) => applyMax(storeA, patch),
      },
    });
    const runB = bGate.then(() =>
      executeWorkflowScript({
        scriptPath: pathB,
        args: {},
        ctx: {
          sessionId: "sess-sandbox",
          cwd: dir,
          runId: "wf_b",
          onRunStats: (patch) => applyMax(storeB, patch),
        },
      }),
    );

    await Promise.all([runA, runB]);

    expect(storeA.done).toBeLessThanOrEqual(storeA.total);
    expect(storeB.done).toBeLessThanOrEqual(storeB.total);
    expect(storeA).toEqual({ total: 3, done: 3 });
    expect(storeB).toEqual({ total: 10, done: 10 });
  });
});
