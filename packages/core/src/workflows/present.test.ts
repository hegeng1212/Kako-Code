import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@kako/shared";
import type { WorkflowRunRecord } from "./store.js";
import {
  isTerminalWorkflowStatus,
  listUnpresentedTerminalWorkflowRuns,
  listTerminalRunsNeedingPresentedHeal,
  transcriptContainsWorkflowNotification,
} from "./present.js";

const baseRun = (patch: Partial<WorkflowRunRecord>): WorkflowRunRecord => ({
  taskId: "wc7e1095a",
  runId: "wf_c7e1095a",
  name: "deep-research",
  description: "大模型报告",
  status: "completed",
  scriptPath: "/tmp/script.js",
  transcriptDir: "/tmp/tx",
  startedAt: "2026-07-14T14:30:00.000Z",
  completedAt: "2026-07-14T14:39:00.000Z",
  agentsTotal: 3,
  agentsDone: 3,
  agentsFailed: 0,
  ...patch,
});

describe("isTerminalWorkflowStatus", () => {
  it("treats completed/error/stopped as terminal", () => {
    expect(isTerminalWorkflowStatus("completed")).toBe(true);
    expect(isTerminalWorkflowStatus("error")).toBe(true);
    expect(isTerminalWorkflowStatus("stopped")).toBe(true);
    expect(isTerminalWorkflowStatus("running")).toBe(false);
    expect(isTerminalWorkflowStatus("pending")).toBe(false);
  });
});

describe("transcriptContainsWorkflowNotification", () => {
  it("finds run-id in harness llmText", () => {
    const transcript: TranscriptMessage[] = [
      {
        id: "1",
        role: "user",
        content: "",
        timestamp: "2026-07-14T14:40:00.000Z",
        metadata: {
          llmText: "<task-notification>\n<run-id>wf_c7e1095a</run-id>\n</task-notification>",
        },
      },
    ];
    expect(transcriptContainsWorkflowNotification(transcript, baseRun({}))).toBe(true);
  });

  it("returns false when notification never landed", () => {
    const transcript: TranscriptMessage[] = [
      {
        id: "1",
        role: "assistant",
        content: "深度研究工作流已在后台启动（任务ID: wc7e1095a）",
        timestamp: "2026-07-14T14:31:00.000Z",
      },
    ];
    expect(transcriptContainsWorkflowNotification(transcript, baseRun({}))).toBe(false);
  });
});

describe("listUnpresentedTerminalWorkflowRuns", () => {
  it("returns completed runs that were never presented", () => {
    const runs = [
      baseRun({}),
      baseRun({
        taskId: "wother",
        runId: "wf_other",
        status: "running",
        completedAt: undefined,
      }),
    ];
    const out = listUnpresentedTerminalWorkflowRuns(runs, []);
    expect(out.map((r) => r.runId)).toEqual(["wf_c7e1095a"]);
  });

  it("skips runs already marked presentedAt", () => {
    const runs = [baseRun({ presentedAt: "2026-07-14T14:40:00.000Z" })];
    expect(listUnpresentedTerminalWorkflowRuns(runs, [])).toEqual([]);
  });

  it("skips runs whose notification is already in the transcript", () => {
    const transcript: TranscriptMessage[] = [
      {
        id: "1",
        role: "user",
        content: "",
        timestamp: "2026-07-14T14:40:00.000Z",
        metadata: {
          llmText: "<task-notification><run-id>wf_c7e1095a</run-id></task-notification>",
        },
      },
    ];
    expect(listUnpresentedTerminalWorkflowRuns([baseRun({})], transcript)).toEqual([]);
  });
});

describe("listTerminalRunsNeedingPresentedHeal", () => {
  it("returns terminal runs present in transcript but missing presentedAt", () => {
    const transcript: TranscriptMessage[] = [
      {
        id: "1",
        role: "user",
        content: "",
        timestamp: "2026-07-14T14:40:00.000Z",
        metadata: {
          llmText: "<task-notification><run-id>wf_c7e1095a</run-id></task-notification>",
        },
      },
    ];
    const out = listTerminalRunsNeedingPresentedHeal([baseRun({})], transcript);
    expect(out).toHaveLength(1);
    expect(out[0]?.runId).toBe("wf_c7e1095a");
  });
});
