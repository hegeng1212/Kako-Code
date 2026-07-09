import type { ToolDefinition, ToolExecutionContext, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_AGENT_DESCRIPTION } from "../claude-tool-text.js";

export interface AgentToolInput {
  description: string;
  prompt: string;
  subagent_type?: string;
  model?: string;
  isolation?: "worktree" | "remote";
  run_in_background?: boolean;
}

export interface AgentToolHost {
  spawnSubAgent(input: AgentToolInput, context: ToolExecutionContext): Promise<string>;
}

const AGENT_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_AGENT_DESCRIPTION);

export const agentToolDefinition: ToolDefinition = {
  name: "Agent",
  description: AGENT_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      description: {
        type: "string",
        description: "A short (3-5 word) description of the task",
      },
      isolation: {
        type: "string",
        enum: ["worktree", "remote"],
        description:
          'Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo. "remote" launches the agent in a remote cloud environment (always runs in background; availability is gated).',
      },
      model: {
        type: "string",
        enum: ["sonnet", "opus", "haiku", "fable"],
        description:
          'Optional model override for this agent. Takes precedence over the agent definition\'s model frontmatter. If omitted, uses the agent definition\'s model, or inherits from the parent. Ignored for subagent_type: "fork" — forks always inherit the parent model.',
      },
      prompt: {
        type: "string",
        description: "The task for the agent to perform",
      },
      run_in_background: {
        type: "boolean",
        description:
          "Set to true to run this agent in the background. You will be notified when it completes.",
      },
      subagent_type: {
        type: "string",
        description: "The type of specialized agent to use for this task",
      },
    },
    required: ["description", "prompt"],
  },
};

/** Map common subagent_type aliases to agent definition names. */
export function normalizeSubagentType(raw: string | undefined): string {
  if (!raw?.trim()) return "general-purpose";
  const key = raw.trim().toLowerCase().replace(/_/g, "-");
  const aliases: Record<string, string> = {
    "general-purpose": "general-purpose",
    generalpurpose: "general-purpose",
    general: "general-purpose",
    explore: "explore",
    plan: "plan",
    planner: "plan",
  };
  return aliases[key] ?? raw.trim();
}

/** Validate subagent type and unsupported isolation modes before spawning. */
export function assertSubAgentSpawnAllowed(
  input: AgentToolInput,
  parentSubagents: string[],
): string {
  if (input.isolation === "remote") {
    throw new Error('Isolation mode "remote" is not supported yet');
  }
  if (input.isolation === "worktree") {
    throw new Error('Isolation mode "worktree" is not supported yet');
  }

  const subagentName = normalizeSubagentType(input.subagent_type);
  if (!parentSubagents.includes(subagentName)) {
    throw new Error(
      `Subagent "${subagentName}" is not allowed. Allowed types: ${parentSubagents.join(", ")}`,
    );
  }
  return subagentName;
}

export function formatSubAgentResult(
  subagentName: string,
  description: string,
  responseText: string,
): string {
  return [
    `Agent "${subagentName}" completed: ${description}`,
    "",
    responseText || "(no text response)",
  ].join("\n");
}

export function createAgentHandler(host: AgentToolHost): ToolHandler {
  return async (input, context) => {
    const description = String(input.description ?? "").trim();
    const prompt = String(input.prompt ?? "").trim();
    if (!description) throw new Error("Agent tool requires description");
    if (!prompt) throw new Error("Agent tool requires prompt");

    return host.spawnSubAgent(
      {
        description,
        prompt,
        subagent_type: input.subagent_type ? String(input.subagent_type) : undefined,
        model: input.model ? String(input.model) : undefined,
        isolation: input.isolation as AgentToolInput["isolation"] | undefined,
        run_in_background: Boolean(input.run_in_background),
      },
      context,
    );
  };
}
