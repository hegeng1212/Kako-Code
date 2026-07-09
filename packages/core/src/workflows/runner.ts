import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { getSessionWorkflowRunDir, getSessionWorkflowScriptPath } from "../config/paths.js";
import { copyWorkflowTemplateToSession, loadWorkflowTemplate, parseMetaFromScriptSource } from "./registry.js";
import { executeWorkflowScript } from "./dsl/sandbox.js";
import { loadWorkflowRuns, saveWorkflowRun, updateWorkflowRun } from "./store.js";
import type { WorkflowRunRecord } from "./store.js";
import { appendJournalEntry, type JournalEntry } from "./journal.js";
import { getWorkflowCompleteHandler } from "./completion-registry.js";
import { AgentResultReplayer, loadAgentResultCache } from "./agent-cache.js";
import {
  clearWorkflowAbort,
  registerWorkflowAbort,
  WorkflowStoppedError,
} from "./control.js";
import { completeBackgroundTask } from "../background/task-store.js";
function resultErrorMessage(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const err = (result as { error?: unknown }).error;
  if (typeof err === "string" && err.trim()) return err.trim();
  return undefined;
}

async function patchWorkflowRun(
  sessionId: string,
  runId: string,
  patch: Partial<WorkflowRunRecord>,
): Promise<void> {
  try {
    await updateWorkflowRun(sessionId, runId, patch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      const logEntry: Omit<Extract<JournalEntry, { type: "log" }>, "at"> = {
        type: "log",
        message: `run update failed: ${message}`,
      };
      await appendJournalEntry(sessionId, runId, logEntry);
    } catch {
      // Best-effort observability only.
    }
  }
}

export function createWorkflowIds(): { taskId: string; runId: string } {
  const suffix = randomBytes(4).toString("hex");
  return { taskId: `w${suffix}`, runId: `wf_${suffix}` };
}

export interface LaunchWorkflowInput {
  sessionId: string;
  cwd: string;
  name?: string;
  script?: string;
  scriptPath?: string;
  args?: unknown;
  resumeFromRunId?: string;
}

export interface LaunchWorkflowResult {
  taskId: string;
  runId: string;
  scriptPath: string;
  transcriptDir: string;
  summary: string;
  record: WorkflowRunRecord;
}

function normalizeWorkflowArgs(args: unknown): unknown {
  if (args === undefined || args === null) return "";
  return args;
}

export async function launchWorkflow(input: LaunchWorkflowInput): Promise<LaunchWorkflowResult> {
  const { taskId, runId } = createWorkflowIds();
  let name = input.name ?? "workflow";

  let scriptPath = input.scriptPath;
  let meta;
  let resumeFromRunId = input.resumeFromRunId;

  if (resumeFromRunId) {
    const runs = await loadWorkflowRuns(input.sessionId);
    const prior = runs.find((run) => run.runId === resumeFromRunId);
    if (!prior) {
      throw new Error(`Prior workflow run not found: ${resumeFromRunId}`);
    }
    if (prior.status === "running" || prior.status === "pending") {
      throw new Error(`Stop the prior workflow run before resuming: ${resumeFromRunId}`);
    }
    scriptPath = scriptPath ?? prior.scriptPath;
    name = prior.name;
    meta = { name: prior.name, description: prior.description };
  }

  if (typeof input.script === "string" && input.script.trim() && !scriptPath) {
    meta = parseMetaFromScriptSource(input.script);
    name = meta.name;
    scriptPath = getSessionWorkflowScriptPath(input.sessionId, meta.name, runId);
    await mkdir(scriptPath.replace(/\/[^/]+$/, ""), { recursive: true });
    await writeFile(scriptPath, input.script, "utf-8");
  } else if (!scriptPath) {
    if (!input.name) throw new Error("Workflow requires name or scriptPath");
    const copied = await copyWorkflowTemplateToSession({
      sessionId: input.sessionId,
      name: input.name,
      runId,
      cwd: input.cwd,
    });
    scriptPath = copied.scriptPath;
    meta = copied.meta;
    name = copied.meta.name;
  } else if (!meta && scriptPath) {
    try {
      const source = await readFile(scriptPath, "utf-8");
      meta = parseMetaFromScriptSource(source);
      name = meta.name;
    } catch {
      meta = { name, description: name };
    }
  }

  if (!scriptPath) {
    throw new Error("Workflow requires name or scriptPath");
  }
  meta ??= { name, description: name };

  const transcriptDir = getSessionWorkflowRunDir(input.sessionId, runId);
  await mkdir(transcriptDir, { recursive: true });

  const record: WorkflowRunRecord = {
    taskId,
    runId,
    name: meta.name,
    description: meta.description,
    status: "running",
    scriptPath,
    transcriptDir,
    startedAt: new Date().toISOString(),
    agentsTotal: 0,
    agentsDone: 0,
    agentsFailed: 0,
  };

  await saveWorkflowRun(input.sessionId, record);

  const abortController = registerWorkflowAbort(input.sessionId, taskId, runId);

  void runWorkflowBackground({
    sessionId: input.sessionId,
    cwd: input.cwd,
    runId,
    taskId,
    scriptPath,
    args: normalizeWorkflowArgs(input.args),
    record,
    resumeFromRunId,
    abortSignal: abortController.signal,
  });

  return {
    taskId,
    runId,
    scriptPath,
    transcriptDir,
    summary: meta.description,
    record,
  };
}

async function runWorkflowBackground(input: {
  sessionId: string;
  cwd: string;
  runId: string;
  taskId: string;
  scriptPath: string;
  args: unknown;
  record: WorkflowRunRecord;
  resumeFromRunId?: string;
  abortSignal: AbortSignal;
}): Promise<void> {
  try {
    let agentReplayer: AgentResultReplayer | undefined;
    if (input.resumeFromRunId) {
      const cache = await loadAgentResultCache(input.sessionId, input.resumeFromRunId);
      agentReplayer = new AgentResultReplayer(cache);
    }

    const result = await executeWorkflowScript({
      scriptPath: input.scriptPath,
      args: input.args,
      ctx: {
        sessionId: input.sessionId,
        cwd: input.cwd,
        runId: input.runId,
        abortSignal: input.abortSignal,
        agentReplayer,
        onRunStats: (patch) => {
          void patchWorkflowRun(input.sessionId, input.runId, patch);
        },
      },
    });
    if (input.abortSignal.aborted) {
      await notifyWorkflowStopped(input.sessionId, input.runId, input.record);
      return;
    }
    const completedAt = new Date().toISOString();
    const scriptError = resultErrorMessage(result);
    if (scriptError) {
      await patchWorkflowRun(input.sessionId, input.runId, {
        status: "error",
        completedAt,
        error: scriptError,
        result,
      });
      void notifyWorkflowComplete(input.sessionId, {
        ...input.record,
        status: "error",
        completedAt,
        error: scriptError,
        result,
      });
      return;
    }
    await patchWorkflowRun(input.sessionId, input.runId, {
      status: "completed",
      completedAt,
      result,
    });
    void notifyWorkflowComplete(input.sessionId, {
      ...input.record,
      status: "completed",
      completedAt,
      result,
    });
  } catch (err) {
    if (err instanceof WorkflowStoppedError || input.abortSignal.aborted) {
      await notifyWorkflowStopped(input.sessionId, input.runId, input.record);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const completedAt = new Date().toISOString();
    await patchWorkflowRun(input.sessionId, input.runId, {
      status: "error",
      completedAt,
      error: message,
    });
    void notifyWorkflowComplete(input.sessionId, {
      ...input.record,
      status: "error",
      completedAt,
      error: message,
    });
  } finally {
    clearWorkflowAbort(input.sessionId, input.taskId);
    completeBackgroundTask(input.sessionId, input.taskId);
  }
}

async function notifyWorkflowStopped(
  sessionId: string,
  runId: string,
  fallback: WorkflowRunRecord,
): Promise<void> {
  const runs = await loadWorkflowRuns(sessionId);
  const record =
    runs.find((run) => run.runId === runId) ??
    ({
      ...fallback,
      status: "stopped",
      completedAt: new Date().toISOString(),
      error: "Stopped by user",
    } satisfies WorkflowRunRecord);
  void notifyWorkflowComplete(sessionId, record);
}

async function notifyWorkflowComplete(sessionId: string, record: WorkflowRunRecord): Promise<void> {
  const handler = getWorkflowCompleteHandler(sessionId);
  if (!handler) return;
  try {
    await handler(record);
  } catch {
    // UI notification failures should not crash the runner.
  }
}

export function formatWorkflowToolResult(launch: LaunchWorkflowResult): string {
  return [
    "Workflow launched in background.",
    `Task ID: ${launch.taskId}`,
    `Summary: ${launch.summary}`,
    `Transcript dir: ${launch.transcriptDir}`,
    `Script file: ${launch.scriptPath}`,
    `(Edit this file with Write/Edit and re-invoke Workflow with {scriptPath: "${launch.scriptPath}"} to iterate without resending the full script.)`,
    `Run ID: ${launch.runId}`,
    `To resume after editing the script: Workflow({scriptPath: "${launch.scriptPath}", resumeFromRunId: "${launch.runId}"}) — completed agents return cached results (cached results may themselves be empty — inspect journal.jsonl before assuming there is something to recover).`,
    "",
    "You will be notified when it completes. Use /workflows to watch live progress.",
  ].join("\n");
}
