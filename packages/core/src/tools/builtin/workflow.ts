import type { ToolDefinition, ToolHandler, ToolExecutionContext } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_WORKFLOW_DESCRIPTION } from "../claude-workflow-text.js";
import { formatWorkflowToolResult, launchWorkflow } from "../../workflows/runner.js";

export const WORKFLOW_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_WORKFLOW_DESCRIPTION);

export const workflowToolDefinition: ToolDefinition = {
  name: "Workflow",
  description: WORKFLOW_DESCRIPTION,
  requiresConfirmation: true,
  inputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      args: {
        description:
          "Optional input value exposed to the script as the global `args`, verbatim. Pass arrays/objects as actual JSON values, NOT as a JSON-encoded string — a stringified list breaks `args.filter`/`args.map` in the script. Use for parameterized named workflows (e.g. a research question).",
      },
      description: {
        type: "string",
        description: "Ignored — set the workflow description in the script's `meta` block.",
      },
      name: {
        type: "string",
        description: adaptClaudeCodeToolText(
          "Name of a predefined workflow (built-in or from .kako/workflows/). Resolves to a self-contained script.",
        ),
      },
      resumeFromRunId: {
        type: "string",
        pattern: "^wf_[a-z0-9-]{6,}$",
        description:
          "Run ID of a prior Workflow invocation to resume from. Completed agent() calls with unchanged (prompt, opts) return their cached results instantly; only edited or new calls re-run. Same-session only. Stop the prior run first (TaskStop) before resuming.",
      },
      script: {
        type: "string",
        maxLength: 524_288,
        description:
          "Self-contained workflow script. Must begin with `export const meta = { name, description, phases }` (pure literal, no computed values) followed by the script body using agent()/parallel()/pipeline()/phase().",
      },
      scriptPath: {
        type: "string",
        description:
          "Path to a workflow script file on disk. Every Workflow invocation persists its script under the session directory and returns the path in the tool result. To iterate, edit that file with Write/Edit and re-invoke Workflow with the same `scriptPath` instead of re-sending the full script. Takes precedence over `script` and `name`.",
      },
      title: {
        type: "string",
        description: "Ignored — set the workflow title in the script's `meta` block.",
      },
    },
  },
};

export const workflowHandler: ToolHandler = async (input, context: ToolExecutionContext) => {
  const name = typeof input.name === "string" ? input.name.trim() : undefined;
  const scriptPath = typeof input.scriptPath === "string" ? input.scriptPath.trim() : undefined;
  if (!name && !scriptPath && typeof input.script !== "string") {
    throw new Error("Workflow requires name, scriptPath, or script");
  }
  if (!context.sessionId) {
    throw new Error("Workflow requires an active session");
  }

  const launch = await launchWorkflow({
    sessionId: context.sessionId,
    cwd: context.cwd,
    name,
    script: typeof input.script === "string" ? input.script : undefined,
    scriptPath,
    args: input.args,
    resumeFromRunId:
      typeof input.resumeFromRunId === "string" ? input.resumeFromRunId : undefined,
  });

  return formatWorkflowToolResult(launch);
};
