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
    };

export function normalizeToolConfirmResult(result: ToolConfirmResult): {
  allowed: boolean;
  permissionMode?: PermissionMode;
  denialReason?: string;
} {
  if (typeof result === "boolean") {
    return { allowed: result };
  }
  return {
    allowed: result.allowed,
    permissionMode: result.permissionMode,
    denialReason: result.denialReason,
  };
}
