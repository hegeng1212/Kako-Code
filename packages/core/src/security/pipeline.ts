import type {
  PermissionMode,
  SessionCapability,
  ToolAuditMetadata,
  ToolCall,
  ToolDefinition,
} from "@kako/shared";
import type { McpApprovalMode } from "@kako/shared";
import { parseMcpToolName } from "@kako/shared";
import type { NetworkPolicy } from "../config/network-store.js";
import { loadMcpRegistry } from "../mcp/config.js";
import { resolveMcpApprovalForToolCall } from "../mcp/approval-policy.js";
import { evaluateMcpServerNetworkAccess } from "../mcp/network-access.js";
import { resolveApprovalDecision } from "./approval-resolver.js";
import { capabilityDenialMessage } from "./capability.js";
import { evaluateNetworkToolGate, evaluateNetworkToolGateWithoutTarget } from "./network-guard.js";
import { evaluateToolRisk } from "./risk-evaluator.js";
import type { SecurityPolicy } from "./policy-store.js";
import { isDeniedSecretPath } from "./secret-guard.js";
import { outsidePolicyAction, resolveSafePath } from "./workspace-guard.js";

const TRUSTED_WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

function skipWriteApprovalForCapability(
  toolCall: ToolCall,
  capability: SessionCapability,
  workspacePaths: string[],
  workspaceNeedsApproval: boolean,
): boolean {
  if (workspacePaths.length === 0) return false;
  if (!TRUSTED_WRITE_TOOLS.has(toolCall.name)) return false;
  if (capability === "FullAccess") return true;
  if (capability === "WorkspaceWrite") return !workspaceNeedsApproval;
  return false;
}

export interface SecurityContext {
  cwd: string;
  capability: SessionCapability;
  policy: SecurityPolicy;
  networkPolicy: NetworkPolicy;
  permissionMode: PermissionMode;
  sessionAllowedHosts: Set<string>;
  sessionAllowedMcpTools: Set<string>;
  sessionAllowedWorkspacePaths: Set<string>;
}

export interface SecurityGateResult {
  allowed: boolean;
  needsConfirm: boolean;
  error?: string;
  audit: ToolAuditMetadata;
  networkTarget?: string;
  networkDecision?: string;
  mcpApproval?: McpApprovalMode;
  /** Target URL/host is on the configured network allowlist. */
  allowlistedNetwork?: boolean;
  /** Write/edit may run without user confirmation (FullAccess: any path; WorkspaceWrite: trusted roots). */
  trustedWorkspaceWrite?: boolean;
}

export async function runSecurityGate(
  toolCall: ToolCall,
  definition: ToolDefinition,
  ctx: SecurityContext,
): Promise<SecurityGateResult> {
  const assessment = evaluateToolRisk(toolCall, definition, ctx.cwd, ctx.policy);
  const audit: ToolAuditMetadata = {
    riskLevel: assessment.level,
    capability: ctx.capability,
    bashTier: assessment.bashTier,
  };

  const capError = capabilityDenialMessage(
    ctx.capability,
    definition.security?.capability ?? [],
  );
  if (capError) {
    return { allowed: false, needsConfirm: false, error: capError, audit };
  }

  let workspaceNeedsApproval = false;
  for (const rawPath of assessment.workspacePaths) {
    if (isDeniedSecretPath(rawPath, ctx.policy)) {
      return {
        allowed: false,
        needsConfirm: false,
        error: `Access denied: ${rawPath} contains sensitive configuration`,
        audit: { ...audit, workspaceViolation: rawPath },
      };
    }
    const check = await resolveSafePath(ctx.cwd, rawPath, ctx.policy);
    if (!check.allowed) {
      const prefixAllowed = [...ctx.sessionAllowedWorkspacePaths].some((p) =>
        check.resolvedPath?.startsWith(p),
      );
      if (prefixAllowed) continue;
      const action = outsidePolicyAction(ctx.policy);
      if (action === "deny" && ctx.capability !== "FullAccess") {
        return {
          allowed: false,
          needsConfirm: false,
          error: check.violation ?? "Path outside workspace",
          audit: { ...audit, workspaceViolation: check.violation },
        };
      }
      if (action === "approve") workspaceNeedsApproval = true;
    }
  }

  let networkNeedsApproval = false;
  let allowlistedNetwork = false;
  let networkTarget: string | undefined;
  let networkDecision: string | undefined;

  if (assessment.requiresNetwork && !toolCall.name.startsWith("mcp/")) {
    const targets = assessment.networkTargets;
    if (targets.length > 0) {
      let skipApproval = true;
      for (const url of targets) {
        const gate = evaluateNetworkToolGate(url, ctx.networkPolicy, ctx.sessionAllowedHosts);
        networkTarget ??= url;
        networkDecision = gate.reason;
        audit.networkTarget = url;
        audit.networkDecision = gate.reason;
        if (gate.action === "deny") {
          return {
            allowed: false,
            needsConfirm: false,
            error: gate.reason,
            audit,
            networkTarget: url,
            networkDecision,
          };
        }
        if (!gate.skipApproval) skipApproval = false;
      }
      allowlistedNetwork = skipApproval;
      if (!skipApproval) networkNeedsApproval = true;
    } else {
      const gate = evaluateNetworkToolGateWithoutTarget(ctx.networkPolicy);
      networkDecision = gate.reason;
      audit.networkDecision = gate.reason;
      if (gate.action === "deny") {
        return {
          allowed: false,
          needsConfirm: false,
          error: gate.reason,
          audit: { ...audit, networkDecision: gate.reason },
        };
      }
      if (!gate.skipApproval) networkNeedsApproval = true;
    }
  }

  const mcpAllowed = ctx.sessionAllowedMcpTools.has(toolCall.name);
  let mcpApproval: McpApprovalMode | undefined;
  if (toolCall.name.startsWith("mcp/")) {
    const registry = await loadMcpRegistry();

    const parsed = parseMcpToolName(toolCall.name);
    const server = parsed
      ? registry.servers.find((entry) => entry.id === parsed.serverId)
      : undefined;

    const mcpNet = server ? evaluateMcpServerNetworkAccess(server, ctx.networkPolicy) : null;
    if (mcpNet) {
      networkTarget = server!.url;
      networkDecision = mcpNet.reason;
      audit.networkTarget = server!.url;
      audit.networkDecision = mcpNet.reason;
      if (mcpNet.action === "deny") {
        return {
          allowed: false,
          needsConfirm: false,
          error: mcpNet.reason,
          audit,
          networkTarget,
          networkDecision,
        };
      }
    }

    mcpApproval = resolveMcpApprovalForToolCall(toolCall.name, registry.servers);
    if (mcpApproval === "deny") {
      return {
        allowed: false,
        needsConfirm: false,
        error: `MCP tool blocked by server policy: ${toolCall.name}`,
        audit: { ...audit, approvalMode: "deny" },
      };
    }

    audit.approvalMode = mcpApproval;

    if (mcpApproval === "never") {
      audit.approvalRequired = false;
      audit.approvalResult = "skipped";
      return {
        allowed: true,
        needsConfirm: false,
        audit,
        networkTarget,
        networkDecision,
        mcpApproval,
      };
    }

    if (mcpApproval === "onRequest" && !mcpAllowed) {
      audit.approvalRequired = true;
      return {
        allowed: true,
        needsConfirm: true,
        audit,
        networkTarget,
        networkDecision,
        mcpApproval,
      };
    }

    audit.approvalRequired = false;
    audit.approvalResult = "skipped";
    return {
      allowed: true,
      needsConfirm: false,
      audit,
      networkTarget,
      networkDecision,
      mcpApproval,
    };
  }

  const bypassBlocked =
    ctx.permissionMode === "bypassPermissions" &&
    ((ctx.policy.bypass.secretsEnforced && assessment.workspacePaths.some((p) => isDeniedSecretPath(p, ctx.policy))) ||
      (ctx.policy.bypass.networkEnforced && assessment.requiresNetwork && !ctx.networkPolicy.enabled));

  const decision = resolveApprovalDecision(ctx.policy, assessment, ctx.permissionMode, {
    workspaceNeedsApproval,
    networkNeedsApproval,
    allowlistedNetwork,
    bypassBlocked,
    readonlyInWorkspace:
      definition.security?.readonly === true &&
      !definition.security?.sideEffect &&
      assessment.workspacePaths.length > 0 &&
      !workspaceNeedsApproval,
    skipWriteConfirm: skipWriteApprovalForCapability(
      toolCall,
      ctx.capability,
      assessment.workspacePaths,
      workspaceNeedsApproval,
    ),
  });

  const trustedWorkspaceWrite = skipWriteApprovalForCapability(
    toolCall,
    ctx.capability,
    assessment.workspacePaths,
    workspaceNeedsApproval,
  );

  audit.approvalMode = decision.mode;

  if (decision.action === "deny") {
    return {
      allowed: false,
      needsConfirm: false,
      error: decision.reason ?? "Denied by security policy",
      audit,
      networkTarget,
      networkDecision,
    };
  }

  if (decision.action === "confirm") {
    audit.approvalRequired = true;
    return {
      allowed: true,
      needsConfirm: true,
      audit,
      networkTarget,
      networkDecision,
      mcpApproval,
      allowlistedNetwork,
      trustedWorkspaceWrite,
    };
  }

  audit.approvalRequired = false;
  audit.approvalResult = "skipped";
  return {
    allowed: true,
    needsConfirm: false,
    audit,
    networkTarget,
    networkDecision,
    mcpApproval,
    allowlistedNetwork,
    trustedWorkspaceWrite,
  };
}
