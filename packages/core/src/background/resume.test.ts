import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSessionWorkflowJournalPath } from "../config/paths.js";
import { saveWorkflowRun } from "../workflows/store.js";
import {
  agentInputFromInterrupted,
  assertWorkflowResumable,
  recoverWorkflowArgsFromJournal,
  resolveInterruptedWorkflowArgs,
} from "./resume.js";
import type { InterruptedAgentItem, InterruptedWorkflowItem } from "./interrupted-store.js";

describe("resume helpers", () => {
  afterEach(() => {
    delete process.env.KAKO_HOME;
  });

  it("agentInputFromInterrupted requires prompt and sets background", () => {
    const item: InterruptedAgentItem = {
      id: "ag-1",
      kind: "agent",
      taskId: "a1",
      description: "Explore Option A",
      prompt: "Look at Option A",
      subagentName: "explore",
      status: "interrupted",
      createdAt: new Date().toISOString(),
      interruptedAt: new Date().toISOString(),
    };
    expect(agentInputFromInterrupted(item)).toEqual({
      description: "Explore Option A",
      prompt: "Look at Option A",
      subagent_type: "explore",
      run_in_background: true,
    });
    expect(() =>
      agentInputFromInterrupted({ ...item, prompt: "  " }),
    ).toThrow(/missing prompt/i);
  });

  it("assertWorkflowResumable rejects missing script", async () => {
    process.env.KAKO_HOME = await mkdtemp(join(tmpdir(), "kako-resume-"));
    const item: InterruptedWorkflowItem = {
      id: "cp-1",
      kind: "workflow",
      taskId: "w1",
      runId: "wf_1",
      name: "deep-research",
      description: "x",
      scriptPath: join(process.env.KAKO_HOME, "missing.js"),
      status: "interrupted",
      createdAt: new Date().toISOString(),
      interruptedAt: new Date().toISOString(),
    };
    await expect(assertWorkflowResumable(item)).rejects.toThrow(/missing or unreadable/i);

    const okPath = join(process.env.KAKO_HOME, "ok.js");
    await mkdir(process.env.KAKO_HOME, { recursive: true });
    await writeFile(okPath, "export default {}", "utf-8");
    await expect(assertWorkflowResumable({ ...item, scriptPath: okPath })).resolves.toBeUndefined();
  });

  it("recoverWorkflowArgsFromJournal prefers scope.question", () => {
    expect(
      recoverWorkflowArgsFromJournal([
        {
          type: "result",
          label: "search-1",
          status: "success",
          output: { question: "wrong" },
          at: "t",
        },
        {
          type: "result",
          label: "scope",
          status: "success",
          output: { question: "儿童辅食研究报告 中国市场 2024-2026" },
          at: "t",
        },
      ]),
    ).toBe("儿童辅食研究报告 中国市场 2024-2026");
  });

  it("resolveInterruptedWorkflowArgs uses checkpoint args, then run.args, then journal", async () => {
    process.env.KAKO_HOME = await mkdtemp(join(tmpdir(), "kako-resume-args-"));
    const sessionId = "sess-args";
    const runId = "wf_args1";
    const base: InterruptedWorkflowItem = {
      id: `wf-${runId}`,
      kind: "workflow",
      taskId: "w1",
      runId,
      name: "deep-research",
      description: "Deep research",
      scriptPath: "/tmp/a.js",
      status: "interrupted",
      createdAt: new Date().toISOString(),
      interruptedAt: new Date().toISOString(),
    };

    await expect(
      resolveInterruptedWorkflowArgs({
        sessionId,
        item: { ...base, args: "from checkpoint" },
      }),
    ).resolves.toBe("from checkpoint");

    await saveWorkflowRun(sessionId, {
      taskId: "w1",
      runId,
      name: "deep-research",
      description: "Deep research",
      status: "stopped",
      scriptPath: "/tmp/a.js",
      transcriptDir: "/tmp/t",
      startedAt: new Date().toISOString(),
      args: "from run record",
      agentsTotal: 1,
      agentsDone: 0,
      agentsFailed: 0,
    });

    await expect(
      resolveInterruptedWorkflowArgs({ sessionId, item: base }),
    ).resolves.toBe("from run record");

    await saveWorkflowRun(sessionId, {
      taskId: "w1",
      runId: "wf_legacy",
      name: "deep-research",
      description: "Deep research",
      status: "stopped",
      scriptPath: "/tmp/a.js",
      transcriptDir: "/tmp/t",
      startedAt: new Date().toISOString(),
      agentsTotal: 1,
      agentsDone: 0,
      agentsFailed: 0,
    });
    const journalPath = getSessionWorkflowJournalPath(sessionId, "wf_legacy");
    await mkdir(journalPath.replace(/\/[^/]+$/, ""), { recursive: true });
    await writeFile(
      journalPath,
      `${JSON.stringify({
        type: "result",
        label: "scope",
        status: "success",
        output: { question: "from journal" },
        at: new Date().toISOString(),
      })}\n`,
      "utf-8",
    );

    await expect(
      resolveInterruptedWorkflowArgs({
        sessionId,
        item: { ...base, runId: "wf_legacy", id: "wf-wf_legacy" },
      }),
    ).resolves.toBe("from journal");
  });

});
