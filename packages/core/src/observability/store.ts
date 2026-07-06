import type {
  McpCallLogEntry,
  McpCallMetrics,
  McpObservabilitySummary,
  McpServerMetrics,
  McpToolMetrics,
  ToolLogEntry,
} from "@kako/shared";
import { mcpToolName, parseMcpToolName } from "@kako/shared";
import { loadMcpRegistry } from "../mcp/config.js";
import { getObservabilityDb } from "./db.js";

interface LogRow {
  timestamp: string;
  session_id: string;
  agent_id: string;
  tool_use_id: string;
  tool_name: string;
  mcp_server_id: string | null;
  mcp_tool_name: string | null;
  input_json: string;
  output_json: string | null;
  status: string;
  duration_ms: number;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function buildMetrics(logs: { status: string; duration_ms: number }[]): McpCallMetrics {
  const total = logs.length;
  const successCount = logs.filter((l) => l.status === "success").length;
  const durations = logs.map((l) => l.duration_ms);
  const avg = durations.length
    ? durations.reduce((sum, v) => sum + v, 0) / durations.length
    : 0;
  return {
    totalCalls: total,
    successCount,
    errorCount: total - successCount,
    successRate: total ? successCount / total : 0,
    avgDurationMs: Math.round(avg),
    p99DurationMs: Math.round(percentile(durations, 99)),
  };
}

function rowToEntry(row: LogRow): McpCallLogEntry | ToolLogEntry {
  const base = {
    timestamp: row.timestamp,
    sessionId: row.session_id,
    agentId: row.agent_id,
    toolUseId: row.tool_use_id,
    toolName: row.tool_name,
    input: JSON.parse(row.input_json) as Record<string, unknown>,
    output: row.output_json ? (JSON.parse(row.output_json) as unknown) : undefined,
    status: row.status as ToolLogEntry["status"],
    durationMs: row.duration_ms,
  };
  if (row.mcp_server_id && row.mcp_tool_name) {
    return {
      ...base,
      mcpServerId: row.mcp_server_id,
      mcpToolName: row.mcp_tool_name,
    };
  }
  const parsed = parseMcpToolName(row.tool_name);
  if (parsed) {
    return { ...base, mcpServerId: parsed.serverId, mcpToolName: parsed.toolName };
  }
  return base as ToolLogEntry;
}

export async function insertToolLogEntry(entry: ToolLogEntry): Promise<void> {
  const db = await getObservabilityDb();
  const parsed = parseMcpToolName(entry.toolName);
  db.prepare(
    `
    INSERT OR REPLACE INTO tool_call_logs (
      timestamp, session_id, agent_id, tool_use_id, tool_name,
      mcp_server_id, mcp_tool_name, input_json, output_json, status, duration_ms
    ) VALUES (
      @timestamp, @session_id, @agent_id, @tool_use_id, @tool_name,
      @mcp_server_id, @mcp_tool_name, @input_json, @output_json, @status, @duration_ms
    )
  `,
  ).run({
    timestamp: entry.timestamp,
    session_id: entry.sessionId,
    agent_id: entry.agentId,
    tool_use_id: entry.toolUseId,
    tool_name: entry.toolName,
    mcp_server_id: entry.mcpServerId ?? parsed?.serverId ?? null,
    mcp_tool_name: entry.mcpToolName ?? parsed?.toolName ?? null,
    input_json: JSON.stringify(entry.input ?? {}),
    output_json: entry.output === undefined ? null : JSON.stringify(entry.output),
    status: entry.status,
    duration_ms: entry.durationMs,
  });
}

async function readMcpRows(): Promise<LogRow[]> {
  const db = await getObservabilityDb();
  return db
    .prepare(
      `
      SELECT * FROM tool_call_logs
      WHERE mcp_server_id IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 50000
    `,
    )
    .all() as LogRow[];
}

export async function getMcpObservabilitySummary(): Promise<McpObservabilitySummary> {
  const rows = await readMcpRows();
  const registry = await loadMcpRegistry();
  const serverNames = new Map(registry.servers.map((s) => [s.id, s.name]));

  const byServer = new Map<string, LogRow[]>();
  const byTool = new Map<string, LogRow[]>();

  for (const row of rows) {
    const sid = row.mcp_server_id!;
    const list = byServer.get(sid) ?? [];
    list.push(row);
    byServer.set(sid, list);

    const toolKey = `${sid}::${row.mcp_tool_name}`;
    const toolList = byTool.get(toolKey) ?? [];
    toolList.push(row);
    byTool.set(toolKey, toolList);
  }

  const servers: McpServerMetrics[] = [...byServer.entries()].map(([serverId, logs]) => ({
    serverId,
    serverName: serverNames.get(serverId) ?? serverId,
    ...buildMetrics(logs),
  }));

  const tools: McpToolMetrics[] = [...byTool.entries()].map(([key, logs]) => {
    const [serverId, toolName] = key.split("::");
    return {
      serverId: serverId!,
      serverName: serverNames.get(serverId!) ?? serverId!,
      toolName: toolName!,
      prefixedName: mcpToolName(serverId!, toolName!),
      ...buildMetrics(logs),
    };
  });

  servers.sort((a, b) => b.totalCalls - a.totalCalls);
  tools.sort((a, b) => b.totalCalls - a.totalCalls);

  return { servers, tools };
}

export async function queryMcpCallLogs(options: {
  serverId?: string;
  toolName?: string;
  limit?: number;
}): Promise<McpCallLogEntry[]> {
  const db = await getObservabilityDb();
  const limit = options.limit ?? 100;
  let sql = `
    SELECT * FROM tool_call_logs
    WHERE mcp_server_id IS NOT NULL
  `;
  const params: Record<string, string | number> = { limit };

  if (options.serverId) {
    sql += " AND mcp_server_id = @server_id";
    params.server_id = options.serverId;
  }
  if (options.toolName) {
    sql += " AND mcp_tool_name = @tool_name";
    params.tool_name = options.toolName;
  }
  sql += " ORDER BY timestamp DESC LIMIT @limit";

  const rows = db.prepare(sql).all(params) as LogRow[];
  return rows.map((r) => rowToEntry(r) as McpCallLogEntry);
}

export async function getObservabilityStats(): Promise<{
  totalLogs: number;
  mcpLogs: number;
  dbPath: string;
}> {
  const db = await getObservabilityDb();
  const { getObservabilityDbPath } = await import("../config/paths.js");
  const total = db.prepare("SELECT COUNT(*) as c FROM tool_call_logs").get() as { c: number };
  const mcp = db
    .prepare("SELECT COUNT(*) as c FROM tool_call_logs WHERE mcp_server_id IS NOT NULL")
    .get() as { c: number };
  return {
    totalLogs: total.c,
    mcpLogs: mcp.c,
    dbPath: getObservabilityDbPath(),
  };
}
