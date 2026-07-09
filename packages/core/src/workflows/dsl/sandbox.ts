import { readFile } from "node:fs/promises";
import { runParallel, runPipeline } from "./concurrency.js";
import {
  runWorkflowAgent,
  type WorkflowAgentContext,
  type WorkflowAgentOpts,
} from "../workflow-agent.js";
import { appendJournalEntry } from "../journal.js";
import { agentCacheKey, AgentResultReplayer } from "../agent-cache.js";
import { assertWorkflowNotAborted, WorkflowStoppedError } from "../control.js";
import { createBudgetView, getTurnBudget, TurnBudgetExhaustedError } from "../budget.js";
import { resolveNestedWorkflowScript } from "../nested.js";
import { stripWorkflowMetaBlock } from "../registry.js";
import {
  AgentConcurrencyGate,
  WORKFLOW_AGENT_LIFETIME_CAP,
  WORKFLOW_MAX_PIPELINE_ITEMS,
  workflowAgentConcurrencyCap,
} from "./limits.js";

export interface WorkflowSandboxContext extends WorkflowAgentContext {
  runId: string;
  abortSignal?: AbortSignal;
  nestingDepth?: number;
  phasePrefix?: string;
  onPhase?: (title: string) => void;
  onLog?: (message: string) => void;
  onRunStats?: (patch: {
    agentsTotal?: number;
    agentsDone?: number;
    agentsFailed?: number;
    currentPhase?: string;
  }) => void;
  agentReplayer?: AgentResultReplayer;
  agentGate?: AgentConcurrencyGate;
  agentLifetimeCount?: { value: number };
}

let agentStats = { total: 0, done: 0, failed: 0 };

function stripExportMeta(source: string): string {
  return stripWorkflowMetaBlock(source);
}

function qualifyPhaseTitle(ctx: WorkflowSandboxContext, title: string): string {
  if (!ctx.phasePrefix) return title;
  if (title.startsWith(ctx.phasePrefix)) return title;
  return `${ctx.phasePrefix} › ${title}`;
}

function wrapParallel<T>(
  fn: typeof runParallel,
  ctx: WorkflowSandboxContext,
): typeof runParallel {
  return (thunks, concurrency) => {
    if (thunks.length > WORKFLOW_MAX_PIPELINE_ITEMS) {
      throw new Error(
        `parallel() accepts at most ${WORKFLOW_MAX_PIPELINE_ITEMS} items (got ${thunks.length})`,
      );
    }
    return fn(thunks, concurrency ?? workflowAgentConcurrencyCap());
  };
}

function wrapPipeline<TItem, TResult>(
  fn: typeof runPipeline,
): typeof runPipeline {
  return (items, ...stages) => {
    if (items.length > WORKFLOW_MAX_PIPELINE_ITEMS) {
      throw new Error(
        `pipeline() accepts at most ${WORKFLOW_MAX_PIPELINE_ITEMS} items (got ${items.length})`,
      );
    }
    return fn(items, ...stages);
  };
}

export async function executeWorkflowScript(input: {
  scriptPath: string;
  args: unknown;
  ctx: WorkflowSandboxContext;
}): Promise<unknown> {
  if (input.ctx.nestingDepth == null) {
    agentStats = { total: 0, done: 0, failed: 0 };
  }

  const lifetime = input.ctx.agentLifetimeCount ?? { value: 0 };
  const gate = input.ctx.agentGate ?? new AgentConcurrencyGate(workflowAgentConcurrencyCap());
  const ctx: WorkflowSandboxContext = {
    ...input.ctx,
    agentGate: gate,
    agentLifetimeCount: lifetime,
  };

  const source = await readFile(input.scriptPath, "utf-8");
  const body = stripExportMeta(source);
  const promptHash = (prompt: string, opts: WorkflowAgentOpts = {}) => agentCacheKey(prompt, opts);

  const agent = async (prompt: string, opts: WorkflowAgentOpts = {}) => {
    assertWorkflowNotAborted(ctx.abortSignal);
    getTurnBudget(ctx.sessionId)?.assertBeforeAgent();

    if (lifetime.value >= WORKFLOW_AGENT_LIFETIME_CAP) {
      throw new Error(`Workflow agent cap reached (${WORKFLOW_AGENT_LIFETIME_CAP})`);
    }
    lifetime.value++;

    const phaseTitle = opts.phase ? qualifyPhaseTitle(ctx, opts.phase) : opts.phase;

    const hash = promptHash(prompt, { ...opts, phase: phaseTitle });
    const cached = ctx.agentReplayer?.tryReplay(prompt, { ...opts, phase: phaseTitle });
    if (cached !== undefined) {
      ctx.onRunStats?.({ agentsTotal: ++agentStats.total });
      const label = opts.label ?? "agent";
      const agentId = `a${lifetime.value}`;
      await appendJournalEntry(ctx.sessionId, ctx.runId, {
        type: "agent_start",
        label,
        phase: phaseTitle,
        agentId,
      });
      agentStats.done++;
      await appendJournalEntry(ctx.sessionId, ctx.runId, {
        type: "result",
        label,
        phase: phaseTitle,
        agentId,
        status: "success",
        output: cached,
        promptHash: hash,
        durationMs: 0,
        tokens: 0,
      });
      ctx.onRunStats?.({
        agentsDone: agentStats.done,
        agentsFailed: agentStats.failed,
      });
      return cached;
    }

    ctx.onRunStats?.({ agentsTotal: ++agentStats.total });
    await gate.acquire();
    let result: unknown;
    const agentId = `a${lifetime.value}`;
    try {
      result = await runWorkflowAgent(prompt, { ...opts, phase: phaseTitle }, {
        ...ctx,
        abortSignal: ctx.abortSignal,
        onAgentStart: async (label, phase) => {
          await appendJournalEntry(ctx.sessionId, ctx.runId, {
            type: "agent_start",
            label,
            phase,
            agentId,
          });
          await ctx.onAgentStart?.(label, phase);
        },
        onAgentEnd: async (end) => {
          agentStats.done++;
          if (end.status !== "success") agentStats.failed++;
          await appendJournalEntry(ctx.sessionId, ctx.runId, {
            type: "result",
            label: end.label,
            phase: end.phase,
            agentId,
            model: end.model,
            tokens: end.tokens,
            durationMs: end.durationMs,
            status: end.status,
            output: end.output,
            promptHash: hash,
          });
          ctx.onRunStats?.({
            agentsDone: agentStats.done,
            agentsFailed: agentStats.failed,
          });
          ctx.onAgentEnd?.(end);
        },
      });
    } finally {
      gate.release();
    }

    if (ctx.abortSignal?.aborted) {
      throw new WorkflowStoppedError();
    }
    return result;
  };

  const phase = async (title: string) => {
    const qualified = qualifyPhaseTitle(ctx, title);
    ctx.onPhase?.(qualified);
    ctx.onRunStats?.({ currentPhase: qualified });
    await appendJournalEntry(ctx.sessionId, ctx.runId, { type: "phase", title: qualified });
  };

  const planPhase = async (title: string, total: number) => {
    const qualified = qualifyPhaseTitle(ctx, title);
    await appendJournalEntry(ctx.sessionId, ctx.runId, { type: "phase_plan", title: qualified, total });
  };

  const log = (message: string) => {
    ctx.onLog?.(message);
    void appendJournalEntry(ctx.sessionId, ctx.runId, { type: "log", message });
  };

  const parallel = wrapParallel(runParallel, ctx);
  const pipeline = wrapPipeline(runPipeline);
  const budget = createBudgetView(ctx.sessionId);

  const workflow = async (nameOrRef: string | { scriptPath: string }, childArgs?: unknown) => {
    if ((ctx.nestingDepth ?? 0) >= 1) {
      throw new Error("workflow() nesting is limited to one level");
    }
    assertWorkflowNotAborted(ctx.abortSignal);
    const { scriptPath, meta } = await resolveNestedWorkflowScript(nameOrRef, ctx.cwd);
    const groupTitle = `▸ ${meta.name}`;
    log(`Nested workflow: ${meta.name}`);
    phase(groupTitle);
    return executeWorkflowScript({
      scriptPath,
      args: childArgs ?? {},
      ctx: {
        ...ctx,
        nestingDepth: (ctx.nestingDepth ?? 0) + 1,
        phasePrefix: groupTitle,
      },
    });
  };

  const determinismPreamble = `
const __RealDate = globalThis.Date;
const __RealMath = globalThis.Math;
const Date = new Proxy(__RealDate, {
  construct(target, args) {
    if (args.length === 0) throw new Error("new Date() is unavailable in workflow scripts");
    return new target(...args);
  },
  get(target, prop, receiver) {
    if (prop === "now") {
      return () => { throw new Error("Date.now() is unavailable in workflow scripts"); };
    }
    return Reflect.get(target, prop, receiver);
  },
});
const Math = new Proxy(__RealMath, {
  get(target, prop, receiver) {
    if (prop === "random") {
      return () => { throw new Error("Math.random() is unavailable in workflow scripts"); };
    }
    return Reflect.get(target, prop, receiver);
  },
});
`;

  const sandboxFn = new Function(
    "args",
    "agent",
    "phase",
    "planPhase",
    "log",
    "parallel",
    "pipeline",
    "workflow",
    "budget",
    `"use strict";\nreturn (async () => {\n${determinismPreamble}\n${body}\n})();`,
  );

  try {
    return await sandboxFn(
      input.args,
      agent,
      phase,
      planPhase,
      log,
      parallel,
      pipeline,
      workflow,
      budget,
    );
  } catch (err) {
    if (err instanceof TurnBudgetExhaustedError) throw err;
    throw err;
  }
}
