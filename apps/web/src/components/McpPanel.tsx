import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  McpCallLogEntry,
  McpObservabilitySummary,
  McpPreset,
  McpServerConfig,
  McpServerMetrics,
  McpServerStatus,
  McpToolInfo,
  McpToolMetrics,
} from "@kako/shared";
import { api } from "../api";
import { aggregateMetrics, EMPTY_METRICS, MetricsBar, pct } from "./mcp-metrics-ui";
import { IconEdit, IconPlay, IconSpinner, IconSync, IconTrash } from "./RowIcons";
import { McpFormPage } from "./McpFormPage";
import { McpUsagePage } from "./McpUsagePage";

type McpView = "manage" | "usage" | "add" | "edit";

interface McpActionToast {
  action: "sync" | "connect";
  success: boolean;
  serverName: string;
  toolCount?: number;
  error?: string;
}

interface McpServerCardProps {
  server: McpServerConfig;
  connected: boolean;
  connecting: boolean;
  connectFailed: boolean;
  expanded: boolean;
  metrics?: McpServerMetrics;
  serverTools: McpToolInfo[];
  toolMetrics: Map<string, McpToolMetrics>;
  toolsSyncedAt?: string;
  syncing?: boolean;
  connectingManual?: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onSyncTools: () => void;
  onConnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenUsage: () => void;
}

function formatSyncedAt(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString();
}

function McpServerCard({
  server,
  connected,
  connecting,
  connectFailed,
  expanded,
  metrics,
  serverTools,
  toolMetrics,
  toolsSyncedAt,
  syncing = false,
  connectingManual = false,
  onToggleExpand,
  onToggleEnabled,
  onSyncTools,
  onConnect,
  onEdit,
  onDelete,
  onOpenUsage,
}: McpServerCardProps) {
  const [hovered, setHovered] = useState(false);
  const showActions = hovered || expanded;

  return (
    <li
      className={`mcp-server-card ${!server.enabled ? "mcp-server-card--disabled" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="mcp-server-card__header">
        <button type="button" className="mcp-server-card__toggle" onClick={onToggleExpand}>
          <span className="mcp-server-card__arrow">{expanded ? "▼" : "▶"}</span>
          <div className="provider-icon" style={{ background: "#6366f1" }}>
            M
          </div>
          <div className="mcp-server-card__info">
            <div className="provider-row__title">
              <span className="provider-row__name">{server.name}</span>
              <span
                className={`tag ${
                  connected ? "tag--active" : connecting ? "tag--pending" : "tag--warn"
                }`}
              >
                {!server.enabled
                  ? "已停用"
                  : connected
                    ? "已连接"
                    : connecting
                      ? "连接中"
                      : "未连接"}
              </span>
              <span className="tag tag--muted">{server.transport.toUpperCase()}</span>
            </div>
            <div className="provider-row__url" style={{ cursor: "default" }}>
              {server.transport === "stdio"
                ? `${server.command} ${server.args?.join(" ") ?? ""}`
                : server.url}
            </div>
            {server.enabled && toolsSyncedAt && (
              <div className="mcp-server-card__meta">
                {serverTools.length} 个工具 · 同步于 {formatSyncedAt(toolsSyncedAt)}
              </div>
            )}
          </div>
        </button>
        <div className={`mcp-server-card__actions ${showActions ? "visible" : ""}`}>
          {server.enabled && connectFailed && !connected && (
            <button
              type="button"
              className="btn btn--enable btn--sm"
              title="手动连接此 MCP 服务"
              disabled={connectingManual}
              onClick={onConnect}
            >
              {connectingManual ? <IconSpinner className="btn__icon" /> : <IconPlay className="btn__icon" />}
              连接
            </button>
          )}
          {server.enabled ? (
            <button
              type="button"
              className="btn btn--disable btn--sm"
              title="停用此 MCP 服务"
              onClick={onToggleEnabled}
            >
              停用
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--enable btn--sm"
              title="启用并连接此 MCP 服务"
              onClick={onToggleEnabled}
            >
              <IconPlay className="btn__icon" />
              启用
            </button>
          )}
          {server.enabled && (
            <button
              type="button"
              className="icon-btn"
              title="同步工具列表"
              disabled={syncing}
              onClick={onSyncTools}
            >
              {syncing ? <IconSpinner className="icon-btn__spinner" /> : <IconSync />}
            </button>
          )}
          <button type="button" className="icon-btn" title="编辑" onClick={onEdit}>
            <IconEdit />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            title="删除"
            onClick={onDelete}
          >
            <IconTrash />
          </button>
        </div>
      </div>

      <MetricsBar {...(metrics ?? { ...EMPTY_METRICS })} />

      {expanded && (
        <div className="mcp-server-card__body">
          {!server.enabled && (
            <p className="mcp-hint">服务已停用，点击「启用」后将自动连接。</p>
          )}
          {server.enabled && connecting && !connected && (
            <p className="mcp-hint">正在连接，将按阶梯间隔自动重试…</p>
          )}
          {server.enabled && connectFailed && !connected && (
            <p className="mcp-hint">自动连接已失败，请点击「连接」手动重试。</p>
          )}
          {server.enabled && !connected && serverTools.length > 0 && !connecting && (
            <p className="mcp-hint">服务未连接，当前显示本地缓存的工具列表。</p>
          )}
          {server.enabled && !connected && serverTools.length === 0 && (
            <p className="mcp-hint">服务未连接，点击同步图标拉取工具列表。</p>
          )}
          {server.enabled && connected && serverTools.length === 0 && (
            <p className="mcp-hint">该服务暂无可用工具。</p>
          )}
          {server.enabled && serverTools.length > 0 && (
            <table className="mcp-tools-table">
              <thead>
                <tr>
                  <th>工具</th>
                  <th>描述</th>
                  <th>调用量</th>
                  <th>成功率</th>
                  <th>平均</th>
                  <th>P99</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {serverTools.map((tool) => {
                  const tm = toolMetrics.get(`${server.id}::${tool.name}`);
                  return (
                    <tr key={tool.name}>
                      <td className="mcp-tools-table__name">{tool.name}</td>
                      <td className="mcp-tools-table__desc">{tool.description}</td>
                      <td>{tm?.totalCalls ?? 0}</td>
                      <td>{tm ? pct(tm.successRate) : "—"}</td>
                      <td>{tm ? `${tm.avgDurationMs}ms` : "—"}</td>
                      <td>{tm ? `${tm.p99DurationMs}ms` : "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={onOpenUsage}
                        >
                          日志
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  );
}

export function McpPanel() {
  const [view, setView] = useState<McpView>("manage");
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statuses, setStatuses] = useState<McpServerStatus[]>([]);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [summary, setSummary] = useState<McpObservabilitySummary | null>(null);
  const [obsStats, setObsStats] = useState<{
    totalLogs: number;
    mcpLogs: number;
    dbPath: string;
  } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recentLogs, setRecentLogs] = useState<McpCallLogEntry[]>([]);
  const [presets, setPresets] = useState<McpPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingToolsId, setSyncingToolsId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<McpActionToast | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusMap = useMemo(
    () => new Map(statuses.map((s) => [s.id, s])),
    [statuses],
  );

  const serverMetrics = useMemo(
    () => new Map(summary?.servers.map((s) => [s.serverId, s]) ?? []),
    [summary],
  );

  const serverNameById = useMemo(
    () => new Map(summary?.servers.map((s) => [s.serverId, s.serverName]) ?? []),
    [summary],
  );

  const toolMetrics = useMemo(() => {
    const map = new Map<string, McpToolMetrics>();
    for (const t of summary?.tools ?? []) {
      map.set(`${t.serverId}::${t.toolName}`, t);
    }
    return map;
  }, [summary]);

  const toolsByServer = useMemo(() => {
    const map = new Map<string, McpToolInfo[]>();
    for (const tool of tools) {
      const list = map.get(tool.serverId) ?? [];
      list.push(tool);
      map.set(tool.serverId, list);
    }
    return map;
  }, [tools]);

  const globalMetrics = useMemo(
    () => aggregateMetrics(summary?.servers ?? []),
    [summary],
  );

  const serverUsageRows = useMemo((): McpServerMetrics[] => {
    return servers.map((server) => {
      const metrics = serverMetrics.get(server.id);
      return (
        metrics ?? {
          serverId: server.id,
          serverName: server.name,
          ...EMPTY_METRICS,
        }
      );
    });
  }, [servers, serverMetrics]);

  const toolUsageRows = useMemo(
    () => [...(summary?.tools ?? [])].sort((a, b) => b.totalCalls - a.totalCalls),
    [summary],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mcp, statusRes, toolsRes, summaryRes, statsRes, recentRes, presetsRes] =
        await Promise.all([
        api.getMcp(),
        api.getMcpStatus(),
        api.listMcpTools(),
        api.getMcpObservability(),
        api.getMcpObservabilityStats(),
        api.getMcpLogs({ limit: 30 }),
        api.getMcpPresets(),
      ]);
      setServers(mcp.servers);
      setStatuses(statusRes.servers);
      setTools(toolsRes.tools);
      setSummary(summaryRes);
      setObsStats(statsRes);
      setRecentLogs(recentRes.logs);
      setPresets(presetsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasConnecting = useMemo(
    () => statuses.some((s) => s.connecting && !s.connected),
    [statuses],
  );

  useEffect(() => {
    if (!hasConnecting) return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [hasConnecting, refresh]);

  useEffect(() => {
    if (!actionToast) return;
    const timer = window.setTimeout(() => setActionToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [actionToast]);

  async function handleToggleEnabled(server: McpServerConfig) {
    const reg = await api.setMcpEnabled(server.id, !server.enabled);
    setServers(reg.servers);
    await refresh();
  }

  async function handleSyncTools(serverId: string) {
    const serverName = servers.find((s) => s.id === serverId)?.name ?? serverId;
    setSyncingToolsId(serverId);
    setActionToast(null);
    try {
      const result = await api.syncMcpTools(serverId);
      if ("error" in result && result.error) {
        setActionToast({ action: "sync", success: false, serverName, error: result.error });
      } else {
        setActionToast({
          action: "sync",
          success: true,
          serverName,
          toolCount: "toolCount" in result ? result.toolCount : undefined,
        });
      }
      await refresh();
    } catch (e) {
      setActionToast({
        action: "sync",
        success: false,
        serverName,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSyncingToolsId(null);
    }
  }

  async function handleConnect(serverId: string) {
    const serverName = servers.find((s) => s.id === serverId)?.name ?? serverId;
    setConnectingId(serverId);
    setActionToast(null);
    try {
      const result = await api.connectMcp(serverId);
      if (result.connected) {
        setActionToast({ action: "connect", success: true, serverName });
      } else {
        setActionToast({
          action: "connect",
          success: false,
          serverName,
          error: result.error ?? "连接失败",
        });
      }
      await refresh();
    } catch (e) {
      setActionToast({
        action: "connect",
        success: false,
        serverName,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConnectingId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`删除 MCP 服务「${name}」？`)) return;
    const m = await api.removeMcp(id);
    setServers(m.servers);
    if (expandedId === id) setExpandedId(null);
    await refresh();
  }

  if (view === "usage") {
    return (
      <McpUsagePage
        globalMetrics={globalMetrics}
        serverUsageRows={serverUsageRows}
        toolUsageRows={toolUsageRows}
        recentLogs={recentLogs}
        obsStats={obsStats}
        serverNameById={serverNameById}
        loading={loading}
        onBack={() => setView("manage")}
        onRefresh={refresh}
      />
    );
  }

  if (view === "add") {
    return (
      <McpFormPage
        mode="add"
        presets={presets}
        existingIds={servers.map((s) => s.id)}
        onBack={() => setView("manage")}
        onSave={async (server) => {
          await api.saveMcp(server);
          await refresh();
          setView("manage");
        }}
      />
    );
  }

  if (view === "edit" && editing) {
    return (
      <McpFormPage
        mode="edit"
        presets={presets}
        existingIds={servers.filter((s) => s.id !== editing.id).map((s) => s.id)}
        server={editing}
        onBack={() => {
          setView("manage");
          setEditing(null);
        }}
        onSave={async (server) => {
          await api.saveMcp(server);
          await refresh();
          setView("manage");
          setEditing(null);
        }}
      />
    );
  }

  return (
    <section className="mcp-panel">
      {error && <div className="banner banner--error">{error}</div>}

      <div className="mcp-toolbar">
        <button className="btn btn--primary" onClick={() => setView("add")}>
          + 添加 MCP
        </button>
        <button className="btn btn--ghost" onClick={() => void refresh()} disabled={loading}>
          刷新
        </button>
        <button
          className="btn btn--ghost mcp-toolbar__usage"
          onClick={() => {
            void refresh();
            setView("usage");
          }}
        >
          使用情况
          {obsStats && obsStats.mcpLogs > 0 && (
            <span className="mcp-toolbar__badge">{obsStats.mcpLogs}</span>
          )}
        </button>
      </div>

      <ul className="mcp-server-list">
        {servers.map((server) => {
          const status = statusMap.get(server.id);
          const connected = status?.connected ?? false;
          const connecting = status?.connecting ?? false;
          const connectFailed = status?.connectFailed ?? false;
          const expanded = expandedId === server.id;
          const metrics = serverMetrics.get(server.id);
          const serverTools = toolsByServer.get(server.id) ?? [];

          return (
            <McpServerCard
              key={server.id}
              server={server}
              connected={connected}
              connecting={connecting}
              connectFailed={connectFailed}
              expanded={expanded}
              metrics={metrics}
              serverTools={serverTools}
              toolMetrics={toolMetrics}
              toolsSyncedAt={status?.toolsSyncedAt}
              syncing={syncingToolsId === server.id}
              connectingManual={connectingId === server.id}
              onToggleExpand={() => setExpandedId(expanded ? null : server.id)}
              onToggleEnabled={() => void handleToggleEnabled(server)}
              onSyncTools={() => void handleSyncTools(server.id)}
              onConnect={() => void handleConnect(server.id)}
              onEdit={() => {
                setEditing(server);
                setView("edit");
              }}
              onDelete={() => void handleDelete(server.id, server.name)}
              onOpenUsage={() => {
                void refresh();
                setView("usage");
              }}
            />
          );
        })}
      </ul>

      {!servers.length && !loading && (
        <div className="empty-state">
          <p>暂无 MCP 服务</p>
        </div>
      )}

      {actionToast && (
        <div className={`test-toast ${actionToast.success ? "ok" : "fail"}`}>
          <strong>
            {actionToast.action === "connect"
              ? actionToast.success
                ? "连接成功"
                : "连接失败"
              : actionToast.success
                ? "同步成功"
                : "同步失败"}
          </strong>
          <span>{actionToast.serverName}</span>
          {actionToast.action === "sync" &&
            actionToast.success &&
            actionToast.toolCount != null && (
              <span>{actionToast.toolCount} 个工具</span>
            )}
          {!actionToast.success && actionToast.error && <p>{actionToast.error}</p>}
          <button type="button" className="icon-btn" onClick={() => setActionToast(null)}>
            ✕
          </button>
        </div>
      )}
    </section>
  );
}
