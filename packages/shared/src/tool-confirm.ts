import type { PermissionMode } from "./agent.js";

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
    };

export function normalizeToolConfirmResult(result: ToolConfirmResult): {
  allowed: boolean;
  permissionMode?: PermissionMode;
  denialReason?: string;
  inputPatch?: Record<string, unknown>;
} {
  if (typeof result === "boolean") {
    return { allowed: result };
  }
  return {
    allowed: result.allowed,
    permissionMode: result.permissionMode,
    denialReason: result.denialReason,
    inputPatch: result.inputPatch,
  };
}
