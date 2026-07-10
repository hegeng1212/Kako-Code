/** Unique identifiers used across the harness. */
export type AgentId = string;
export type SessionId = string;
export type RunId = string;
export type ToolUseId = string;
export type SkillId = string;

/** Permission modes for tool execution (per-agent). */
export type PermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "bypassPermissions";

export type { SessionCapability, ApprovalMode } from "./security.js";

/** Agent definition loaded from YAML/Markdown frontmatter. */
export interface AgentDefinition {
  name: string;
  description: string;
  model: string;
  /** Path to system prompt file or inline prompt. */
  systemPrompt: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  permissionMode?: PermissionMode;
  maxTurns?: number;
  hooks?: AgentHooks;
  subagents?: string[];
}

export interface AgentHooks {
  PreToolUse?: string[];
  PostToolUse?: string[];
  SessionStart?: string[];
  SessionEnd?: string[];
}

/** Runtime agent instance within a session. */
export interface AgentInstance {
  id: AgentId;
  definition: AgentDefinition;
  sessionId: SessionId;
  parentToolUseId?: ToolUseId;
  runId: RunId;
  startedAt: string;
  status: AgentStatus;
}

export type AgentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Result returned by a sub-agent to its parent. */
export interface AgentResult {
  agentId: AgentId;
  runId: RunId;
  summary: string;
  status: AgentStatus;
  error?: string;
  tokenUsage?: TokenUsageSummary;
}

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Options for spawning a sub-agent via the Agent tool. */
export interface SpawnAgentOptions {
  agentName: string;
  prompt: string;
  parentToolUseId?: ToolUseId;
  runInBackground?: boolean;
  readonly?: boolean;
}
