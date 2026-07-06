import type { AgentId, RunId, SessionId, ToolUseId } from "./agent.js";
import type { LLMTokenUsage } from "./llm.js";
import type { ToolResultStatus } from "./tool.js";

/** Log entry for a tool invocation. */
export interface ToolLogEntry {
  timestamp: string;
  sessionId: SessionId;
  agentId: AgentId;
  toolUseId: ToolUseId;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: ToolResultStatus;
  durationMs: number;
  /** Set when toolName is mcp/{serverId}/{toolName} */
  mcpServerId?: string;
  mcpToolName?: string;
}

/** Aggregated MCP / tool call metrics. */
export interface McpCallMetrics {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  /** 0–1 */
  successRate: number;
  avgDurationMs: number;
  p99DurationMs: number;
}

export interface McpServerMetrics extends McpCallMetrics {
  serverId: string;
  serverName: string;
}

export interface McpToolMetrics extends McpCallMetrics {
  serverId: string;
  serverName: string;
  toolName: string;
  prefixedName: string;
}

export interface McpObservabilitySummary {
  servers: McpServerMetrics[];
  tools: McpToolMetrics[];
}

export type McpCallLogEntry = ToolLogEntry & {
  mcpServerId: string;
  mcpToolName: string;
};

/** Log entry for a skill activation. */
export interface SkillLogEntry {
  timestamp: string;
  sessionId: SessionId;
  agentId: AgentId;
  skillName: string;
  reason: string;
  durationMs: number;
  steps?: string[];
}

/** Agent run tree node for observability. */
export interface AgentRunNode {
  runId: RunId;
  agentId: AgentId;
  agentName: string;
  parentRunId?: RunId;
  parentToolUseId?: ToolUseId;
  status: string;
  startedAt: string;
  endedAt?: string;
  children: AgentRunNode[];
  tokenUsage?: LLMTokenUsage;
}

/** Harness-wide observability event. */
export interface ObservabilityEvent {
  type: "tool" | "skill" | "llm" | "agent" | "session" | "error";
  timestamp: string;
  sessionId: SessionId;
  payload: Record<string, unknown>;
}
