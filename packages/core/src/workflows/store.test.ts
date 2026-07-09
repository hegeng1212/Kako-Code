import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadWorkflowRuns,
  parseRunsFileText,
  saveWorkflowRun,
  updateWorkflowRun,
  type WorkflowRunRecord,
} from "./store.js";

const sampleRun = (runId: string): WorkflowRunRecord => ({
  taskId: `w${runId}`,
  runId,
  name: "deep-research",
  description: "test",
  status: "running",
  scriptPath: "/tmp/script.js",
  transcriptDir: "/tmp/transcripts",
  startedAt: new Date().toISOString(),
  agentsTotal: 0,
  agentsDone: 0,
  agentsFailed: 0,
});

describe("parseRunsFileText", () => {
  it("recovers valid prefix when trailing garbage was appended", () => {
    const corrupt = `{
  "runs": [
    {
      "taskId": "we5f37724",
      "runId": "wf_e5f37724",
      "name": "deep-research",
      "status": "running"
    }
  ]
}
entPhase": "Scope"
    }
  ]
}`;
    const parsed = parseRunsFileText(corrupt);
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]?.runId).toBe("wf_e5f37724");
  });
});

describe("workflow store", () => {
  let home = "";
  const sessionId = "sess-store-test";

  afterEach(() => {
    delete process.env.KAKO_HOME;
    vi.restoreAllMocks();
  });

  it("serializes concurrent updates without losing runs", async () => {
    home = await mkdtemp(join(tmpdir(), "kako-store-"));
    process.env.KAKO_HOME = home;

    await saveWorkflowRun(sessionId, sampleRun("wf_000001"));

    await Promise.all([
      updateWorkflowRun(sessionId, "wf_000001", { agentsTotal: 1 }),
      updateWorkflowRun(sessionId, "wf_000001", { currentPhase: "Scope" }),
      updateWorkflowRun(sessionId, "wf_000001", { agentsDone: 1 }),
    ]);

    const runs = await loadWorkflowRuns(sessionId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.agentsTotal).toBe(1);
    expect(runs[0]?.currentPhase).toBe("Scope");
    expect(runs[0]?.agentsDone).toBe(1);

    const raw = await readFile(join(home, "memory/sessions", sessionId, "workflows/runs.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("repairs corrupted runs.json on load", async () => {
    home = await mkdtemp(join(tmpdir(), "kako-store-"));
    process.env.KAKO_HOME = home;
    const path = join(home, "memory/sessions", sessionId, "workflows/runs.json");
    await mkdir(join(home, "memory/sessions", sessionId, "workflows"), { recursive: true });
    await writeFile(
      path,
      `{
  "runs": [
    {
      "taskId": "we5f37724",
      "runId": "wf_e5f37724",
      "name": "deep-research",
      "description": "test",
      "status": "running",
      "scriptPath": "/tmp/script.js",
      "transcriptDir": "/tmp/transcripts",
      "startedAt": "2026-07-08T07:34:02.480Z",
      "agentsTotal": 1,
      "agentsDone": 0,
      "agentsFailed": 0
    }
  ]
}
entPhase": "Scope"
    }
  ]
}
`,
      "utf-8",
    );

    const runs = await loadWorkflowRuns(sessionId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.name).toBe("deep-research");

    const repaired = await readFile(path, "utf-8");
    expect(() => JSON.parse(repaired)).not.toThrow();
    expect(repaired).not.toContain("entPhase");
  });
});
