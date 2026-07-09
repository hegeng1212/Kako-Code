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

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kako-sandbox-"));
    clearTurnBudget("sess-sandbox");
  });

  afterEach(async () => {
    clearTurnBudget("sess-sandbox");
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
});
