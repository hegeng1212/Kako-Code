/** MCP server transport type. */
export type McpTransportType = "stdio" | "sse" | "http";

/** Connection block inside MCP JSON config (Claude / CC Switch style). */
export interface McpConnectionConfig {
  type: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** Built-in MCP template for the add form. */
export interface McpPreset {
  id: string;
  label: string;
  title: string;
  displayName: string;
  config: McpConnectionConfig;
}

/** MCP tool approval — server default with optional per-tool overrides. */
export type McpApprovalMode = "never" | "onRequest" | "deny";

/** Default when server-level approvalMode is unset. */
export const MCP_APPROVAL_DEFAULT: McpApprovalMode = "onRequest";

/** MCP server registration config. */
export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransportType;
  /** stdio: executable command */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** sse: remote server URL */
  url?: string;
  headers?: Record<string, string>;
  preset?: string;
  /** Server-wide tool approval default. Unset = {@link MCP_APPROVAL_DEFAULT}. */
  approvalMode?: McpApprovalMode;
  /** Per-tool approval; overrides {@link approvalMode} when set. */
  toolApproval?: Record<string, McpApprovalMode>;
  createdAt?: string;
  updatedAt?: string;
}

export interface McpRegistry {
  version: number;
  servers: McpServerConfig[];
}

/** MCP tool metadata exposed to the harness. */
export interface McpToolInfo {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerStatus {
  id: string;
  name: string;
  connected: boolean;
  /** Background connect in progress (stepped retry, attempts 1–5). */
  connecting?: boolean;
  /** Stepped retry exhausted (>5 failures); manual connect available. */
  connectFailed?: boolean;
  connectError?: string;
  toolCount: number;
  toolsSyncedAt?: string;
}

export interface McpConnectResult {
  serverId: string;
  connected: boolean;
  error?: string;
}

/** Cached MCP tools for one server. */
export interface McpServerToolsCache {
  serverId: string;
  serverName: string;
  syncedAt: string;
  tools: McpToolInfo[];
}

export interface McpToolsCacheFile {
  version: number;
  servers: Record<string, McpServerToolsCache>;
}

export interface McpToolsSyncResult {
  serverId: string;
  connected: boolean;
  toolCount: number;
  syncedAt?: string;
  error?: string;
}

/** Prefixed tool name: mcp/{serverId}/{toolName} */
export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp/${serverId}/${toolName}`;
}

export function parseMcpToolName(
  prefixed: string,
): { serverId: string; toolName: string } | null {
  if (!prefixed.startsWith("mcp/")) return null;
  const parts = prefixed.slice(4).split("/");
  if (parts.length < 2) return null;
  const serverId = parts[0]!;
  const toolName = parts.slice(1).join("/");
  return { serverId, toolName };
}

/** Effective MCP tool approval — tool override wins over server default. */
export function resolveMcpToolApprovalMode(
  server: Pick<McpServerConfig, "approvalMode" | "toolApproval"> | undefined,
  toolName: string,
): McpApprovalMode {
  const toolMode = server?.toolApproval?.[toolName];
  if (toolMode) return toolMode;
  return server?.approvalMode ?? MCP_APPROVAL_DEFAULT;
}

export function connectionConfigToJson(config: McpConnectionConfig): string {
  return JSON.stringify(config, null, 2);
}

function normalizeMcpTransportType(type: unknown): McpTransportType | null {
  if (type === "stdio" || type === "sse" || type === "http") return type;
  if (type === "streamable-http" || type === "streamable_http") return "http";
  return null;
}

function parseStringRecord(
  value: unknown,
  fieldName: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val !== "string") {
      throw new Error(`${fieldName}.${key} 必须是字符串`);
    }
    out[key] = val;
  }
  return out;
}

function parseRemoteMcpConfig(
  obj: Record<string, unknown>,
  type: "sse" | "http",
): McpConnectionConfig {
  if (typeof obj.url !== "string" || !obj.url.trim()) {
    throw new Error(`${type} 类型需要 url 字段`);
  }
  return {
    type,
    url: obj.url.trim(),
    headers: parseStringRecord(obj.headers, "headers"),
  };
}

export function parseMcpConnectionJson(text: string): McpConnectionConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON 格式无效");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("JSON 必须是对象");
  }
  const obj = parsed as Record<string, unknown>;
  const type = normalizeMcpTransportType(obj.type);
  if (!type) {
    throw new Error('type 必须是 "stdio"、"sse" 或 "http"');
  }
  if (type === "stdio") {
    if (typeof obj.command !== "string" || !obj.command.trim()) {
      throw new Error("stdio 类型需要 command 字段");
    }
    const args = obj.args;
    if (args !== undefined && (!Array.isArray(args) || args.some((a) => typeof a !== "string"))) {
      throw new Error("args 必须是字符串数组");
    }
    return {
      type: "stdio",
      command: obj.command.trim(),
      args: args as string[] | undefined,
      env: parseStringRecord(obj.env, "env"),
    };
  }
  return parseRemoteMcpConfig(obj, type);
}

export function mcpServerFromForm(input: {
  id: string;
  name: string;
  config: McpConnectionConfig;
  preset?: string;
  enabled?: boolean;
  createdAt?: string;
  approvalMode?: McpApprovalMode;
  toolApproval?: Record<string, McpApprovalMode>;
}): McpServerConfig {
  const base = {
    id: input.id.trim(),
    name: input.name.trim(),
    enabled: input.enabled ?? true,
    preset: input.preset,
    transport: input.config.type,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    approvalMode: input.approvalMode ?? MCP_APPROVAL_DEFAULT,
    ...(input.toolApproval && Object.keys(input.toolApproval).length > 0
      ? { toolApproval: input.toolApproval }
      : {}),
  };
  if (input.config.type === "stdio") {
    return {
      ...base,
      command: input.config.command,
      args: input.config.args,
      env: input.config.env,
    };
  }
  return {
    ...base,
    url: input.config.url,
    headers: input.config.headers,
  };
}

export function mcpServerToConnectionConfig(server: McpServerConfig): McpConnectionConfig {
  if (server.transport === "stdio") {
    return {
      type: "stdio",
      command: server.command,
      args: server.args,
      env: server.env,
    };
  }
  return {
    type: server.transport,
    url: server.url,
    headers: server.headers,
  };
}
