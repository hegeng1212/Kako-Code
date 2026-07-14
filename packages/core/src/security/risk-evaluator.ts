import type {
  ApprovalMode,
  BashTier,
  PermissionMode,
  RiskLevel,
  ToolCall,
  ToolDefinition,
} from "@kako/shared";
import { parseMcpToolName } from "@kako/shared";
import { resolvePath } from "../tools/builtin/path.js";
import { bashRequiresNetwork, classifyBashCommand, extractHttpUrlsFromBash } from "./bash-policy.js";
import type { SecurityPolicy } from "./policy-store.js";

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  requiresNetwork: boolean;
  networkTargets: string[];
  bashTier?: BashTier;
  workspacePaths: string[];
}

const FILE_TOOLS = new Set(["Read", "Write", "Edit", "NotebookEdit"]);
const SEARCH_SCOPE_TOOLS = new Set(["Grep", "Glob"]);

function filePathFromInput(input: Record<string, unknown>, cwd: string): string | null {
  const raw = input.file_path ?? input.path ?? input.notebook_path;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return resolvePath(raw, cwd);
}

function searchScopePathFromInput(toolCall: ToolCall, cwd: string): string {
  const raw = toolCall.input.path;
  if (typeof raw === "string" && raw.trim()) {
    return resolvePath(raw, cwd);
  }
  return resolvePath(cwd, cwd);
}

function riskFromLevel(current: RiskLevel, next: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ["none", "low", "medium", "high", "critical"];
  return order.indexOf(next) > order.indexOf(current) ? next : current;
}

export function evaluateToolRisk(
  toolCall: ToolCall,
  definition: ToolDefinition,
  cwd: string,
  policy: SecurityPolicy,
): RiskAssessment {
  const meta = definition.security;
  let level: RiskLevel = meta?.defaultRiskLevel ?? "low";
  const reasons: string[] = [];
  const workspacePaths: string[] = [];
  let requiresNetwork = meta?.requiresNetwork ?? false;
  const networkTargets: string[] = [];
  let bashTier: BashTier | undefined;

  if (meta?.sideEffect) {
    level = riskFromLevel(level, "medium");
    reasons.push("tool has side effects");
  }
  if (meta?.modifiesExternal) {
    level = riskFromLevel(level, "high");
    reasons.push("tool modifies external systems");
  }

  if (FILE_TOOLS.has(toolCall.name)) {
    const path = filePathFromInput(toolCall.input, cwd);
    if (path) workspacePaths.push(path);
    if (toolCall.name !== "Read") {
      level = riskFromLevel(level, "medium");
    }
  }

  if (SEARCH_SCOPE_TOOLS.has(toolCall.name)) {
    workspacePaths.push(searchScopePathFromInput(toolCall, cwd));
  }

  if (toolCall.name === "Bash") {
    const command = String(toolCall.input.command ?? "");
    bashTier = classifyBashCommand(command);
    if (bashTier === "safe") level = riskFromLevel(level, "low");
    else if (bashTier === "risky") level = riskFromLevel(level, "medium");
    else level = riskFromLevel(level, "critical");

    if (bashRequiresNetwork(command)) {
      requiresNetwork = true;
      reasons.push("bash command requires network");
      networkTargets.push(...extractHttpUrlsFromBash(command));
    }

    const workDir = toolCall.input.working_directory;
    if (typeof workDir === "string" && workDir.trim()) {
      workspacePaths.push(resolvePath(workDir, cwd));
    }

    if (policy.delete.protectBulk && bashTier === "dangerous" && /\brm\b/.test(command)) {
      level = "critical";
      reasons.push("bulk delete protection");
    }
  }

  if (toolCall.name === "WebFetch" && typeof toolCall.input.url === "string") {
    requiresNetwork = true;
    networkTargets.push(toolCall.input.url);
    level = riskFromLevel(level, "medium");
  }

  if (toolCall.name === "WebSearch") {
    requiresNetwork = true;
    level = riskFromLevel(level, "medium");
  }

  const mcp = parseMcpToolName(toolCall.name);
  if (mcp) {
    level = riskFromLevel(level, meta?.defaultRiskLevel ?? "medium");
    if (meta?.requiresNetwork) {
      requiresNetwork = true;
      reasons.push("mcp remote transport");
    }
    if (meta?.sideEffect) {
      level = riskFromLevel(level, "medium");
      reasons.push("mcp side effect");
    }
  }

  if (definition.requiresConfirmation && level === "low") {
    level = "medium";
  }

  return { level, reasons, requiresNetwork, networkTargets, bashTier, workspacePaths };
}

export function bashApprovalMode(policy: SecurityPolicy, tier: BashTier): ApprovalMode {
  if (tier === "safe") return policy.bash.safeTier;
  if (tier === "risky") return policy.bash.riskyTier;
  return policy.bash.dangerousTier;
}

export function effectiveApprovalMode(
  policy: SecurityPolicy,
  assessment: RiskAssessment,
  permissionMode: PermissionMode,
): ApprovalMode {
  if (permissionMode === "bypassPermissions") return "never";
  if (assessment.bashTier) {
    return bashApprovalMode(policy, assessment.bashTier);
  }
  return policy.approval.byRisk?.[assessment.level] ?? policy.approval.unknownRiskPolicy;
}
