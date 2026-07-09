import { appendFile, mkdir, readFile } from "node:fs/promises";
import { getSessionWorkflowJournalPath } from "../config/paths.js";

export type JournalEntry =
  | { type: "phase"; title: string; at: string }
  | { type: "phase_plan"; title: string; total: number; at: string }
  | { type: "halt"; phase: string; reason?: string; at: string }
  | { type: "agent_start"; label: string; phase?: string; agentId?: string; at: string }
  | {
      type: "result";
      label: string;
      phase?: string;
      agentId?: string;
      model?: string;
      tokens?: number;
      durationMs?: number;
      status: "success" | "error" | "skipped";
      output?: unknown;
      promptHash?: string;
      at: string;
    }
  | { type: "log"; message: string; at: string };

export interface AgentView {
  label: string;
  agentId?: string;
  phase?: string;
  model?: string;
  tokens?: number;
  durationMs?: number;
  status: "success" | "error" | "skipped" | "running";
  outputSummary?: string;
  output?: unknown;
}

export interface WorkflowPhaseDef {
  title: string;
  detail?: string;
  /** Planned agent count — shown as 0/N from workflow start; denominator stays fixed. */
  agents?: number;
}

export interface PhaseView {
  title: string;
  detail?: string;
  entered: boolean;
  done: number;
  total: number;
  failed: number;
  /** Set when meta or phase_plan fixes the denominator. */
  plannedTotal?: number;
  /** Workflow halted on this phase — show ✘ only when fatal. */
  fatal?: boolean;
  agents: AgentView[];
  logs: string[];
}

export function createHaltJournalEntry(
  phase: string,
  reason?: string,
): Omit<Extract<JournalEntry, { type: "halt" }>, "at"> {
  return { type: "halt", phase, reason };
}

export async function appendJournalEntry(
  sessionId: string,
  runId: string,
  entry: Omit<JournalEntry, "at">,
): Promise<void> {
  const path = getSessionWorkflowJournalPath(sessionId, runId);
  await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  const line: JournalEntry = { ...entry, at: new Date().toISOString() } as JournalEntry;
  await appendFile(path, `${JSON.stringify(line)}\n`, "utf-8");
}

export async function readJournalEntries(
  sessionId: string,
  runId: string,
): Promise<JournalEntry[]> {
  const path = getSessionWorkflowJournalPath(sessionId, runId);
  try {
    const text = await readFile(path, "utf-8");
    const entries: JournalEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as JournalEntry);
      } catch {
        // Skip corrupt lines — partial journal reads beat failing the whole file.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export function summarizeAgentOutput(output: unknown): string | undefined {
  if (output === undefined || output === null) return undefined;
  if (typeof output === "string") {
    const trimmed = output.trim();
    return trimmed.length > 240 ? `${trimmed.slice(0, 239)}…` : trimmed;
  }
  if (typeof output !== "object") return String(output);
  const obj = output as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.trim()) {
    return obj.error.trim();
  }
  if (typeof obj.summary === "string" && obj.summary.trim()) {
    const s = obj.summary.trim();
    return s.length > 240 ? `${s.slice(0, 239)}…` : s;
  }
  if (typeof obj.question === "string" && obj.question.trim()) {
    return `Q: ${obj.question.trim()}`;
  }
  if (Array.isArray(obj.angles)) {
    return `${obj.angles.length} search angles`;
  }
  if (Array.isArray(obj.results)) {
    return `${obj.results.length} search results`;
  }
  if (Array.isArray(obj.claims)) {
    return `${obj.claims.length} claims`;
  }
  if (Array.isArray(obj.findings)) {
    return `${obj.findings.length} findings`;
  }
  try {
    const json = JSON.stringify(output);
    return json.length > 240 ? `${json.slice(0, 239)}…` : json;
  } catch {
    return undefined;
  }
}

export function resolveCurrentPhaseFromJournal(entries: JournalEntry[]): string | undefined {
  let current: string | undefined;
  for (const entry of entries) {
    if (entry.type === "phase") {
      current = entry.title;
    }
  }
  return current;
}

function emptyPhaseView(title: string, detail?: string, plannedAgents?: number): PhaseView {
  const planned = plannedAgents != null && plannedAgents > 0 ? plannedAgents : undefined;
  return {
    title,
    detail,
    entered: false,
    done: 0,
    total: planned ?? 0,
    failed: 0,
    plannedTotal: planned,
    agents: [],
    logs: [],
  };
}

function applyPlannedTotal(view: PhaseView, total: number): void {
  if (total <= 0) return;
  view.plannedTotal = total;
  view.total = total;
}

/** ✘ only when this phase blocked the workflow (explicit halt or all agents failed with no continuation). */
export function isPhaseFatal(phase: PhaseView, index: number, phases: PhaseView[]): boolean {
  if (phase.fatal) return true;
  const laterEntered = phases.slice(index + 1).some((p) => p.entered);
  if (laterEntered) return false;
  const terminal = phase.agents.filter((a) => a.status !== "running");
  if (!phase.entered || terminal.length === 0) return false;
  const succeeded = terminal.filter((a) => a.status === "success").length;
  return succeeded === 0 && phase.failed > 0;
}

/** ✔ when the workflow moved past this phase or all planned agents finished with at least one success. */
export function isPhaseSuccessful(phase: PhaseView, index: number, phases: PhaseView[]): boolean {
  if (isPhaseFatal(phase, index, phases)) return false;
  const laterEntered = phases.slice(index + 1).some((p) => p.entered);
  if (laterEntered) return true;
  const succeeded = phase.agents.filter((a) => a.status === "success").length;
  if (succeeded === 0) return false;
  if (phase.plannedTotal != null && phase.plannedTotal > 0) {
    return phase.done >= phase.plannedTotal;
  }
  const terminal = phase.agents.filter((a) => a.status !== "running");
  return terminal.length > 0 && terminal.every((a) => a.status !== "running");
}

function resolvePhaseTitle(
  entryPhase: string | undefined,
  currentPhase: string | undefined,
  metaOrder: string[],
): string {
  if (entryPhase) return entryPhase;
  if (currentPhase) return currentPhase;
  return metaOrder[0] ?? "Unknown";
}

function ensurePhase(
  byPhase: Map<string, PhaseView>,
  order: string[],
  title: string,
  detail?: string,
): PhaseView {
  if (!byPhase.has(title)) {
    order.push(title);
    byPhase.set(title, emptyPhaseView(title, detail));
  }
  const view = byPhase.get(title)!;
  if (detail && !view.detail) view.detail = detail;
  return view;
}

function seedPhaseDefs(
  byPhase: Map<string, PhaseView>,
  order: string[],
  phaseDefs: WorkflowPhaseDef[],
): void {
  for (const def of phaseDefs) {
    const view = ensurePhase(byPhase, order, def.title, def.detail);
    if (def.agents != null && def.agents > 0) {
      applyPlannedTotal(view, def.agents);
    }
  }
}

function applyAgentResult(view: PhaseView, agent: AgentView, status: "success" | "error" | "skipped"): void {
  if (agent.status !== "running") return;
  agent.status = status;
  view.done++;
  if (status === "error" || status === "skipped") {
    view.failed++;
  }
}

export function aggregateWorkflowJournal(
  entries: JournalEntry[],
  phaseDefs: WorkflowPhaseDef[] = [],
): PhaseView[] {
  const byPhase = new Map<string, PhaseView>();
  const order: string[] = [];
  const pendingById = new Map<string, AgentView>();
  const pendingQueues = new Map<string, AgentView[]>();

  seedPhaseDefs(byPhase, order, phaseDefs);

  let currentPhase: string | undefined;

  for (const entry of entries) {
    if (entry.type === "phase") {
      const view = ensurePhase(byPhase, order, entry.title);
      view.entered = true;
      currentPhase = entry.title;
    }
    if (entry.type === "phase_plan") {
      const view = ensurePhase(byPhase, order, entry.title);
      applyPlannedTotal(view, entry.total);
    }
    if (entry.type === "halt") {
      const view = ensurePhase(byPhase, order, entry.phase);
      view.entered = true;
      view.fatal = true;
      currentPhase = entry.phase;
    }
    if (entry.type === "log") {
      const target = currentPhase && byPhase.has(currentPhase) ? currentPhase : order[0];
      if (target && byPhase.has(target)) {
        byPhase.get(target)!.logs.push(entry.message);
      }
    }
    if (entry.type === "agent_start") {
      const phase = resolvePhaseTitle(entry.phase, currentPhase, order);
      const view = ensurePhase(byPhase, order, phase);
      if (entry.agentId) {
        const existing = view.agents.find((a) => a.agentId === entry.agentId);
        if (existing) {
          currentPhase = phase;
          continue;
        }
      }
      view.entered = true;
      if (view.plannedTotal == null) {
        view.total++;
      }
      const agent: AgentView = {
        label: entry.label,
        agentId: entry.agentId,
        phase,
        status: "running",
      };
      view.agents.push(agent);
      if (entry.agentId) {
        pendingById.set(entry.agentId, agent);
      } else {
        const key = `${phase}\0${entry.label}`;
        const queue = pendingQueues.get(key) ?? [];
        queue.push(agent);
        pendingQueues.set(key, queue);
      }
      currentPhase = phase;
    }
    if (entry.type === "result") {
      const phase = resolvePhaseTitle(entry.phase, currentPhase, order);
      const view = ensurePhase(byPhase, order, phase);
      view.entered = true;
      let agent =
        (entry.agentId ? pendingById.get(entry.agentId) : undefined) ??
        (entry.agentId
          ? view.agents.find((a) => a.agentId === entry.agentId && a.status === "running")
          : undefined) ??
        pendingQueues.get(`${phase}\0${entry.label}`)?.shift() ??
        (!entry.agentId
          ? view.agents.find((a) => a.label === entry.label && a.status === "running")
          : undefined);
      if (!agent) {
        agent = {
          label: entry.label,
          agentId: entry.agentId,
          phase,
          status: "running",
        };
        if (view.plannedTotal == null) {
          view.total++;
        }
        view.agents.push(agent);
      }
      agent.agentId ??= entry.agentId;
      agent.model = entry.model;
      agent.tokens = entry.tokens;
      agent.durationMs = entry.durationMs;
      agent.output = entry.output;
      agent.outputSummary = summarizeAgentOutput(entry.output);
      applyAgentResult(view, agent, entry.status);
      if (entry.agentId) {
        pendingById.delete(entry.agentId);
      }
      currentPhase = phase;
    }
  }

  return order.map((title) => byPhase.get(title)!).filter(Boolean);
}
