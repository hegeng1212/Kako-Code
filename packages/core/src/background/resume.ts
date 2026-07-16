import { access } from "node:fs/promises";
import type { AgentToolInput } from "../tools/builtin/agent-tool.js";
import { readJournalEntries, type JournalEntry } from "../workflows/journal.js";
import {
  hasWorkflowArgs,
  launchWorkflow,
  type LaunchWorkflowResult,
} from "../workflows/runner.js";
import { loadWorkflowRuns } from "../workflows/store.js";
import {
  removeInterruptedItem,
  type InterruptedAgentItem,
  type InterruptedWorkflowItem,
} from "./interrupted-store.js";

export async function assertWorkflowResumable(item: InterruptedWorkflowItem): Promise<void> {
  try {
    await access(item.scriptPath);
  } catch {
    throw new Error(`Workflow script missing or unreadable: ${item.scriptPath}`);
  }
}

export function agentInputFromInterrupted(item: InterruptedAgentItem): AgentToolInput {
  if (!item.prompt.trim()) {
    throw new Error("Interrupted agent is missing prompt — cannot resume");
  }
  return {
    description: item.description,
    prompt: item.prompt,
    subagent_type: item.subagentName,
    run_in_background: true,
  };
}

/**
 * Recover Workflow args for older checkpoints that never persisted them.
 * Prefers a successful Scope agent's structured `question` field (deep-research).
 */
export function recoverWorkflowArgsFromJournal(entries: JournalEntry[]): unknown | undefined {
  const results = entries.filter(
    (entry): entry is Extract<JournalEntry, { type: "result" }> =>
      entry.type === "result" && entry.status === "success",
  );
  const ordered = [
    ...results.filter((entry) => entry.label === "scope"),
    ...results.filter((entry) => entry.label !== "scope"),
  ];
  for (const entry of ordered) {
    const output = entry.output;
    if (!output || typeof output !== "object") continue;
    const question = (output as { question?: unknown }).question;
    if (typeof question === "string" && question.trim()) return question.trim();
    const query = (output as { query?: unknown }).query;
    if (typeof query === "string" && query.trim()) return query.trim();
  }
  return undefined;
}

export async function resolveInterruptedWorkflowArgs(input: {
  sessionId: string;
  item: InterruptedWorkflowItem;
}): Promise<unknown> {
  if (hasWorkflowArgs(input.item.args)) return input.item.args;

  const runs = await loadWorkflowRuns(input.sessionId);
  const prior = runs.find((run) => run.runId === input.item.runId);
  if (prior && hasWorkflowArgs(prior.args)) return prior.args;

  if (prior) {
    const entries = await readJournalEntries(input.sessionId, prior.runId);
    const recovered = recoverWorkflowArgsFromJournal(entries);
    if (hasWorkflowArgs(recovered)) return recovered;
  }

  return input.item.args;
}

export async function resumeInterruptedWorkflow(input: {
  sessionId: string;
  cwd: string;
  item: InterruptedWorkflowItem;
}): Promise<LaunchWorkflowResult> {
  await assertWorkflowResumable(input.item);
  const runs = await loadWorkflowRuns(input.sessionId);
  const prior = runs.find((run) => run.runId === input.item.runId);
  if (prior && (prior.status === "running" || prior.status === "pending")) {
    throw new Error(`Stop the prior workflow run before resuming: ${input.item.runId}`);
  }
  const args = await resolveInterruptedWorkflowArgs({
    sessionId: input.sessionId,
    item: input.item,
  });
  const result = await launchWorkflow({
    sessionId: input.sessionId,
    cwd: input.cwd,
    scriptPath: input.item.scriptPath,
    args,
    resumeFromRunId: input.item.runId,
  });
  await removeInterruptedItem(input.sessionId, input.item.id);
  return result;
}
