import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveWorkflowArtifact } from "./save.js";
import type { WorkflowRunRecord } from "./store.js";

describe("saveWorkflowArtifact", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kako-wf-save-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes markdown and json artifacts", async () => {
    const run: WorkflowRunRecord = {
      taskId: "wtest1234",
      runId: "wf_test1234",
      name: "deep-research",
      description: "Deep research harness",
      status: "completed",
      scriptPath: "/tmp/script.js",
      transcriptDir: dir,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      agentsTotal: 3,
      agentsDone: 3,
      agentsFailed: 0,
      result: {
        summary: "Market grew 5%",
        findings: [{ claim: "Growth", confidence: "high", sources: ["https://a"], evidence: "data" }],
        caveats: "Limited sources",
      },
    };

    const { markdownPath, jsonPath } = await saveWorkflowArtifact("sess-1", run);
    const markdown = await readFile(markdownPath, "utf-8");
    const json = JSON.parse(await readFile(jsonPath, "utf-8")) as { run: WorkflowRunRecord };

    expect(markdown).toContain("# deep-research workflow save");
    expect(markdown).toContain("Market grew 5%");
    expect(markdown).toContain("Growth");
    expect(json.run.runId).toBe("wf_test1234");
  });
});
