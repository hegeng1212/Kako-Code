/** Risk tier for tool-call policy decisions. */
export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

/** Session capability level — gates which tool abilities are available. */
export type SessionCapability = "ReadOnly" | "WorkspaceWrite" | "FullAccess";

/** How approval is resolved for a given risk tier. */
export type ApprovalMode = "never" | "onRequest" | "always" | "deny";

export type ToolCapabilityKind = "read" | "write" | "exec" | "network" | "mcp";

/** Declarative security metadata on a tool definition. */
export interface ToolSecurityMetadata {
  readonly?: boolean;
  /** Side effects override readonly — still requires confirmation when true. */
  sideEffect?: boolean;
  requiresNetwork?: boolean;
  modifiesExternal?: boolean;
  defaultRiskLevel?: RiskLevel;
  capability?: ToolCapabilityKind[];
}

export type OutsideWorkspacePolicy = "deny" | "approve" | "allow";

export type BashTier = "safe" | "risky" | "dangerous";

export type SessionAllowKind =
  | "writes"
  | "bash-command"
  | "network-host"
  | "mcp-tool"
  | "workspace-path";

export interface NetworkConfigFile {
  version: number;
  /** When true: open network with blacklist. When false: allowlist only. */
  enabled: boolean;
  allowlist: string[];
  blacklist: string[];
  userAllowlist: string[];
  /** MCP server IDs denied network when {@link enabled} is false. Empty = all remote MCP allowed. */
  mcpNetworkDenials: string[];
}

export interface SecurityConfigFile {
  version: number;
  workspace: {
    trustedRoots?: string[];
    /** User-added roots beyond inherited workspace defaults. */
    extraTrustedRoots?: string[];
    /** Read-only roots derived from the active workspace (API response). */
    inheritedTrustedRoots?: string[];
    deniedRoots?: string[];
    outsidePolicy: OutsideWorkspacePolicy;
  };
  capabilities: {
    default: SessionCapability;
  };
}

/** Audit fields attached to tool execution logs. */
export interface ToolAuditMetadata {
  riskLevel?: RiskLevel;
  approvalRequired?: boolean;
  approvalResult?: "allowed" | "denied" | "skipped";
  approvalMode?: ApprovalMode;
  capability?: SessionCapability;
  workspaceViolation?: string;
  networkTarget?: string;
  networkDecision?: string;
  bashTier?: BashTier;
}
