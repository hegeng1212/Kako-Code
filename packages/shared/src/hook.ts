import type { ToolCall, ToolResult } from "./tool.js";
import type { AgentInstance } from "./agent.js";

/** Hook event types (lifecycle). */
export type HookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop"
  | "SessionEnd";

export interface HookContext {
  event: HookEvent;
  sessionId: string;
  agentId: string;
  timestamp: string;
}

export interface PreToolUseHookContext extends HookContext {
  event: "PreToolUse";
  toolCall: ToolCall;
}

export interface PostToolUseHookContext extends HookContext {
  event: "PostToolUse";
  result: ToolResult;
}

export interface SubagentHookContext extends HookContext {
  event: "SubagentStart" | "SubagentStop";
  subagent: AgentInstance;
}

/** Hook handler return — can deny or modify tool calls. */
export interface HookResult {
  allow: boolean;
  modifiedInput?: Record<string, unknown>;
  message?: string;
}

export type HookHandler = (
  context: HookContext,
) => Promise<HookResult | void>;

export interface HookRegistration {
  event: HookEvent;
  name: string;
  handler: HookHandler;
}
