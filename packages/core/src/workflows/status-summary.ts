import type { WorkflowRunRecord } from "./store.js";
import { loadWorkflowRuns } from "./store.js";

function elapsedLabel(startedAt: string, completedAt?: string): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "";
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  const ms = Math.max(0, (Number.isFinite(end) ? end : Date.now()) - start);
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Compact status text for Skill(workflows) — current session only. */
export function formatWorkflowRunsStatus(runs: WorkflowRunRecord[]): string {
  if (runs.length === 0) {
    return "No workflows in this session.";
  }
  const sorted = [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const lines = sorted.map((run) => {
    const phase = run.currentPhase ? ` · ${run.currentPhase}` : "";
    const agents =
      run.agentsTotal > 0
        ? ` · agents ${run.agentsDone}/${run.agentsTotal}`
        : "";
    const elapsed = elapsedLabel(run.startedAt, run.completedAt);
    const age = elapsed ? ` · ${elapsed}` : "";
    const err = run.error ? ` · error: ${run.error}` : "";
    return `- ${run.name} [${run.status}] task=${run.taskId} run=${run.runId}${phase}${agents}${age}${err}`;
  });
  return ["Workflows in this session:", ...lines].join("\n");
}

export async function formatSessionWorkflowsStatus(sessionId: string): Promise<string> {
  const runs = await loadWorkflowRuns(sessionId);
  return formatWorkflowRunsStatus(runs);
}
