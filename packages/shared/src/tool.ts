import type { AgentId, PermissionMode, SessionId, ToolUseId } from "./agent.js";
import type { AskUserQuestionPrompt } from "./ask-user-question.js";

/** JSON Schema subset for tool input/output definitions. */
export interface JsonSchema {
  $schema?: string;
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  propertyNames?: JsonSchema;
  pattern?: string;
  maxLength?: number;
}

/** Tool definition registered in the Tool Registry. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  /** Whether the tool requires user confirmation before execution. */
  requiresConfirmation?: boolean;
  /** Sandbox constraints for file/shell operations. */
  sandbox?: ToolSandbox;
}

export interface ToolSandbox {
  /** Allowed working directory (absolute path). */
  cwd?: string;
  timeoutMs?: number;
  /** Glob patterns for allowed file paths. */
  allowlist?: string[];
}

/** A tool call requested by the LLM. */
export interface ToolCall {
  id: ToolUseId;
  name: string;
  input: Record<string, unknown>;
}

/** Result of a tool execution. */
export interface ToolResult {
  toolUseId: ToolUseId;
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  status: ToolResultStatus;
  error?: string;
  durationMs: number;
  agentId: AgentId;
  sessionId: SessionId;
}

export type ToolResultStatus = "success" | "error" | "denied" | "timeout";

/** Handler signature for built-in or plugin tools. */
export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<unknown>;

export interface ToolExecutionContext {
  agentId: AgentId;
  sessionId: SessionId;
  toolUseId: ToolUseId;
  cwd: string;
  signal?: AbortSignal;
  /** Interactive prompt for AskUserQuestion tool (provided by CLI harness). */
  askUserQuestion?: AskUserQuestionPrompt;
  /** Mark a file path as read in the current conversation turn (Edit prerequisite). */
  markFileRead?: (path: string) => void;
  /** Whether the file was Read earlier in this conversation turn. */
  hasReadFile?: (path: string) => boolean;
  /** Skill names allowed for this agent (from agent YAML). */
  allowedSkills?: string[];
  /** Whether a skill was already activated in this turn. */
  isSkillActive?: (name: string) => boolean;
  /** Current permission mode for this tool registry turn. */
  getPermissionMode?: () => PermissionMode;
  /** Switch permission mode mid-turn (e.g. EnterPlanMode / ExitPlanMode). */
  setPermissionMode?: (mode: PermissionMode) => void;
  /** Plan file path for the active plan mode session. */
  getPlanFilePath?: () => string | undefined;
  setPlanFilePath?: (path: string | undefined) => void;
  /** Permission mode chosen when the user approved ExitPlanMode. */
  getApprovedPermissionMode?: () => PermissionMode | undefined;
  /** Switch session cwd for worktree isolation (EnterWorktree / ExitWorktree). */
  setCwd?: (cwd: string) => void;
  getWorktreeSession?: () => WorktreeSessionInfo | undefined;
  setWorktreeSession?: (session: WorktreeSessionInfo | undefined) => void;
}

/** Active git worktree session state (EnterWorktree / ExitWorktree). */
export interface WorktreeSessionInfo {
  repoRoot: string;
  originalCwd: string;
  worktreePath: string;
  created: boolean;
  branch: string;
  name?: string;
}
