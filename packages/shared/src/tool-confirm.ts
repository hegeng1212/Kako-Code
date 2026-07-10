import type { PermissionMode } from "./agent.js";
import type { SessionAllowKind } from "./security.js";

/** Result of a tool confirmation prompt (boolean shorthand or structured). */
export type ToolConfirmResult =
  | boolean
  | {
      allowed: boolean;
      /** Permission mode to apply after ExitPlanMode approval. */
      permissionMode?: PermissionMode;
      /** Shown to the model when the user denies or requests revisions. */
      denialReason?: string;
      /** Merged into tool input before execution (e.g. edited workflow scriptPath). */
      inputPatch?: Record<string, unknown>;
      /** Auto-allow similar actions for the rest of this session. */
      sessionAllow?: SessionAllowKind;
      /** Host approved for network access (with sessionAllow network-host). */
      networkHost?: string;
      /** MCP tool name approved (with sessionAllow mcp-tool). */
      mcpTool?: string;
      /** Path prefix approved (with sessionAllow workspace-path). */
      workspacePath?: string;
      /** Hosts to persist in network userAllowlist after approval. */
      networkAllowlistHosts?: string[];
    };

export function normalizeToolConfirmResult(result: ToolConfirmResult): {
  allowed: boolean;
  permissionMode?: PermissionMode;
  denialReason?: string;
  inputPatch?: Record<string, unknown>;
  sessionAllow?: SessionAllowKind;
  networkHost?: string;
  mcpTool?: string;
  workspacePath?: string;
  networkAllowlistHosts?: string[];
} {
  if (typeof result === "boolean") {
    return { allowed: result };
  }
  return {
    allowed: result.allowed,
    permissionMode: result.permissionMode,
    denialReason: result.denialReason,
    inputPatch: result.inputPatch,
    sessionAllow: result.sessionAllow,
    networkHost: result.networkHost,
    mcpTool: result.mcpTool,
    workspacePath: result.workspacePath,
    networkAllowlistHosts: result.networkAllowlistHosts,
  };
}
