import type { LLMMessage } from "@kako/shared";
import { loadAgent } from "../agent/loader.js";
import { buildMessages, resolveEnvironmentInfo } from "../agent/context.js";
import { runAgentLoop } from "../agent/loop.js";
import { createLLMRouter, resolveModel } from "../llm/router.js";
import { loadProviderRegistry } from "../config/provider-store.js";
import { ToolRegistry } from "../tools/registry.js";
import { resolveAllowedToolNames } from "../tools/builtin/index.js";
import { webFetchToolDefinition } from "../tools/builtin/web-fetch.js";
import { webSearchToolDefinition } from "../tools/builtin/web-search.js";
import { createWorkflowWebFetchHandler, createWorkflowWebSearchHandler } from "./workflow-tools.js";
import { createStructuredOutputTool, parseStructuredOutput } from "../tools/builtin/structured-output.js";
import { ToolLogger } from "../observability/tool-logger.js";
import { createMessage } from "../memory/store.js";
import { WorkflowStoppedError } from "./control.js";
import { getTurnBudget } from "./budget.js";
import { WORKFLOW_AGENT_TIMEOUT_MS } from "./dsl/limits.js";

export interface WorkflowAgentOpts {
  label?: string;
  phase?: string;
  schema?: Record<string, unknown>;
  model?: string;
}

export interface WorkflowAgentContext {
  sessionId: string;
  cwd: string;
  abortSignal?: AbortSignal;
  onAgentStart?: (label: string, phase?: string) => void | Promise<void>;
  onAgentEnd?: (input: {
    label: string;
    phase?: string;
    model: string;
    tokens: number;
    durationMs: number;
    status: "success" | "error" | "skipped";
    output?: unknown;
  }) => void | Promise<void>;
}

export async function runWorkflowAgent(
  prompt: string,
  opts: WorkflowAgentOpts,
  ctx: WorkflowAgentContext,
): Promise<unknown | null> {
  const label = opts.label ?? "agent";
  const phase = opts.phase;
  const started = Date.now();
  await ctx.onAgentStart?.(label, phase);

  const timeoutSignal = AbortSignal.timeout(WORKFLOW_AGENT_TIMEOUT_MS);
  const agentAbort =
    ctx.abortSignal != null
      ? AbortSignal.any([ctx.abortSignal, timeoutSignal])
      : timeoutSignal;
  const shouldAbort = () => agentAbort.aborted;

  try {
    getTurnBudget(ctx.sessionId)?.assertBeforeAgent();
    const registry = await loadProviderRegistry();
    const router = createLLMRouter(registry);
    const definition = await loadAgent("main", ctx.cwd);
    const model = opts.model?.trim()
      ? await resolveModel(opts.model, registry)
      : await resolveModel(definition.model, registry);
    const environment = await resolveEnvironmentInfo(ctx.cwd, model);

    const toolRegistry = new ToolRegistry({
      cwd: ctx.cwd,
      sessionId: ctx.sessionId,
      agentId: `workflow/${label}`,
      permissionMode: "bypassPermissions",
    });
    toolRegistry.register(webSearchToolDefinition, createWorkflowWebSearchHandler(ctx.sessionId));
    toolRegistry.register(webFetchToolDefinition, createWorkflowWebFetchHandler());

    let structuredToolName: string | undefined;
    if (opts.schema) {
      const { definition: structDef, handler: structHandler } = createStructuredOutputTool(opts.schema);
      structuredToolName = structDef.name;
      toolRegistry.register(structDef, structHandler);
    }

    const systemAddendum = opts.schema
      ? "\n\nYou MUST finish by calling the StructuredOutput tool exactly once with valid JSON matching the schema. Do not write prose."
      : "\n\nReturn raw data only — your final message is the return value, not user-facing prose.";

    const messages: LLMMessage[] = await buildMessages({
      definition: {
        ...definition,
        systemPrompt: definition.systemPrompt + systemAddendum,
      },
      transcript: [createMessage("user", prompt)],
      environment,
    });

    const allowedTools = resolveAllowedToolNames(
      structuredToolName ? ["WebSearch", "WebFetch", structuredToolName] : ["WebSearch", "WebFetch"],
      toolRegistry,
      { excludeAgent: true },
    );

    const logger = new ToolLogger();
    let outputTokens = 0;
    let structuredResult: unknown;
    const responseText = await runAgentLoop({
      router,
      registry: toolRegistry,
      toolLogger: logger,
      messages,
      allowedTools,
      model,
      maxTurns: opts.schema ? 5 : 4,
      blockAgentTool: true,
      shouldAbort: () => shouldAbort(),
      callbacks: {
        onStreamUsage: (usage) => {
          outputTokens += usage.outputTokens;
          getTurnBudget(ctx.sessionId)?.recordOutputTokens(usage.outputTokens);
        },
        onToolEnd: (name, status, _error, output) => {
          if (
            opts.schema &&
            structuredToolName &&
            name === structuredToolName &&
            status === "success" &&
            output
          ) {
            structuredResult = parseStructuredOutput(output);
          }
        },
      },
    });

    if (timeoutSignal.aborted && !ctx.abortSignal?.aborted) {
      throw new Error(`Agent timed out after ${Math.round(WORKFLOW_AGENT_TIMEOUT_MS / 1000)}s`);
    }

    if (outputTokens === 0) {
      outputTokens = Math.ceil(responseText.length / 4);
      getTurnBudget(ctx.sessionId)?.recordOutputTokens(outputTokens);
    }

    if (opts.schema) {
      const parsed =
        structuredResult !== undefined
          ? structuredResult
          : parseStructuredOutput(responseText);
      await ctx.onAgentEnd?.({
        label,
        phase,
        model,
        tokens: outputTokens,
        durationMs: Date.now() - started,
        status: "success",
        output: parsed,
      });
      return parsed;
    }

    await ctx.onAgentEnd?.({
      label,
      phase,
      model,
      tokens: outputTokens,
      durationMs: Date.now() - started,
      status: "success",
      output: responseText,
    });
    return responseText;
  } catch (err) {
    if (ctx.abortSignal?.aborted) {
      await ctx.onAgentEnd?.({
        label,
        phase: opts.phase,
        model: opts.model ?? "unknown",
        tokens: 0,
        durationMs: Date.now() - started,
        status: "skipped",
        output: "Stopped",
      });
      throw new WorkflowStoppedError();
    }
    await ctx.onAgentEnd?.({
      label,
      phase: opts.phase,
      model: opts.model ?? "unknown",
      tokens: 0,
      durationMs: Date.now() - started,
      status: "error",
      output: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
