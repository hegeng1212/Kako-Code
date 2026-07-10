import type { ApprovalMode, PermissionMode } from "@kako/shared";
import type { RiskAssessment } from "./risk-evaluator.js";
import { effectiveApprovalMode } from "./risk-evaluator.js";
import type { SecurityPolicy } from "./policy-store.js";

export type ApprovalAction = "allow" | "confirm" | "deny";

export interface ApprovalDecision {
  action: ApprovalAction;
  mode: ApprovalMode;
  reason?: string;
}

export function resolveApprovalDecision(
  policy: SecurityPolicy,
  assessment: RiskAssessment,
  permissionMode: PermissionMode,
  options?: {
    workspaceNeedsApproval?: boolean;
    networkNeedsApproval?: boolean;
    /** Network target matches configured allowlist — skip user approval. */
    allowlistedNetwork?: boolean;
    bypassBlocked?: boolean;
    /** Read-only tool with all paths inside workspace — skip risk-tier confirmation. */
    readonlyInWorkspace?: boolean;
    /** Write/edit allowed without user confirmation for this capability/path policy. */
    skipWriteConfirm?: boolean;
  },
): ApprovalDecision {
  if (options?.bypassBlocked) {
    return { action: "deny", mode: "always", reason: "Policy cannot be bypassed" };
  }

  if (
    options?.readonlyInWorkspace &&
    !options.workspaceNeedsApproval &&
    !options.networkNeedsApproval
  ) {
    return { action: "allow", mode: "never" };
  }

  if (options?.skipWriteConfirm && !options.networkNeedsApproval) {
    return { action: "allow", mode: "never" };
  }

  if (options?.allowlistedNetwork && !options.workspaceNeedsApproval) {
    return { action: "allow", mode: "never" };
  }

  const mode = effectiveApprovalMode(policy, assessment, permissionMode);

  if (options?.workspaceNeedsApproval || options?.networkNeedsApproval) {
    if (mode === "deny") {
      return { action: "deny", mode, reason: "Outside policy requires approval but tier is deny" };
    }
    return { action: "confirm", mode: "onRequest", reason: "Outside workspace or network policy" };
  }

  if (mode === "never") return { action: "allow", mode };
  if (mode === "deny") {
    return { action: "deny", mode, reason: `Risk level ${assessment.level} is denied by policy` };
  }
  return { action: "confirm", mode };
}
