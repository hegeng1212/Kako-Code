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
import { aggregateMetrics, CallCount, EMPTY_METRICS, MetricsBar, pct } from "./mcp-metrics-ui";
import { IconChevronDown, IconEdit, IconPlay, IconPlus, IconRefresh, IconSpinner, IconSync, IconTrash } from "./RowIcons";
import { PanelToolbar, ToolbarButton } from "./PanelToolbar";
import { useConfirmDialog } from "./ConfirmDialog";
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
      className={`mcp-server-card ${!server.enabled ? "mcp-server-card--disabled" : ""} ${expanded ? "mcp-server-card--expanded" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="mcp-server-card__row">
        <div className="provider-row__drag" title="拖动排序（即将支持）" aria-hidden="true">
          <span /><span /><span /><span /><span /><span />
        </div>

        <button type="button" className="mcp-server-card__toggle" onClick={onToggleExpand}>
          <div className="provider-icon mcp-server-card__icon">M</div>
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
            <div className="provider-row__url mcp-server-card__endpoint">
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
          <button
            type="button"
            className={`mcp-server-card__chevron ${expanded ? "mcp-server-card__chevron--open" : ""}`}
            title={expanded ? "收起" : "展开详情"}
            aria-label={expanded ? "收起" : "展开详情"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            <IconChevronDown />
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
              <colgroup>
                <col />
                <col />
                <col className="mcp-tools-table__col-metric--calls" />
                <col className="mcp-tools-table__col-metric--rate" />
                <col className="mcp-tools-table__col-metric--duration" />
                <col className="mcp-tools-table__col-metric--duration" />
                <col className="mcp-tools-table__col-action" />
              </colgroup>
              <thead>
                <tr>
                  <th>工具</th>
                  <th>描述</th>
                  <th className="mcp-tools-table__metric">调用量</th>
                  <th className="mcp-tools-table__metric">成功率</th>
                  <th className="mcp-tools-table__metric">平均</th>
                  <th className="mcp-tools-table__metric">P99</th>
                  <th className="mcp-tools-table__action" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {serverTools.map((tool) => {
                  const tm = toolMetrics.get(`${server.id}::${tool.name}`);
                  return (
                    <tr key={tool.name}>
                      <td className="mcp-tools-table__name" title={tool.name}>
                        {tool.name}
                      </td>
                      <td className="mcp-tools-table__desc" title={tool.description || undefined}>
                        {tool.description || "—"}
                      </td>
                      <td className="mcp-tools-table__metric mcp-tools-table__metric--calls">
                        <CallCount count={tm?.totalCalls ?? 0} />
                      </td>
                      <td className="mcp-tools-table__metric">{tm ? pct(tm.successRate) : "—"}</td>
                      <td className="mcp-tools-table__metric">{tm ? `${tm.avgDurationMs}ms` : "—"}</td>
                      <td className="mcp-tools-table__metric">{tm ? `${tm.p99DurationMs}ms` : "—"}</td>
                      <td className="mcp-tools-table__action">
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
  const { requestConfirm, dialog: confirmDialog } = useConfirmDialog();

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

  const refreshConnectingStatus = useCallback(async () => {
    try {
      const statusRes = await api.getMcpStatus();
      setStatuses(statusRes.servers);
    } catch {
      // ignore transient poll errors
    }
  }, []);

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

    let cancelled = false;
    let timer: number | undefined;
    let delayMs = 2_000;
    let polls = 0;
    const maxPolls = 90;

    const tick = () => {
      if (cancelled || polls >= maxPolls) return;
      if (document.hidden) {
        timer = window.setTimeout(tick, Math.max(delayMs, 10_000));
        return;
      }
      polls += 1;
      void refreshConnectingStatus().finally(() => {
        if (cancelled) return;
        delayMs = Math.min(Math.round(delayMs * 1.25), 10_000);
        timer = window.setTimeout(tick, delayMs);
      });
    };

    timer = window.setTimeout(tick, delayMs);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hasConnecting, refreshConnectingStatus]);

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && hasConnecting) {
        void refreshConnectingStatus();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [hasConnecting, refreshConnectingStatus]);

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
    const ok = await requestConfirm({
      title: "删除 MCP 服务",
      message: `确定删除「${name}」？此操作不可恢复。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
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

      <PanelToolbar
        className="panel-toolbar--mcp"
        badge={
          <>
            已配置 <strong>{servers.length}</strong> 个 MCP 服务
          </>
        }
        actions={
          <>
            <ToolbarButton title="刷新" onClick={() => void refresh()} disabled={loading}>
              <IconRefresh className="btn__icon" />
              刷新
            </ToolbarButton>
            <ToolbarButton title="使用情况" onClick={() => { void refresh(); setView("usage"); }}>
              使用情况
              {obsStats && obsStats.mcpLogs > 0 && (
                <span className="panel-toolbar__count">{obsStats.mcpLogs}</span>
              )}
            </ToolbarButton>
            <ToolbarButton title="添加 MCP" onClick={() => setView("add")}>
              <IconPlus className="btn__icon" />
              添加 MCP
            </ToolbarButton>
          </>
        }
      />

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
          <div className="empty-state__icon" aria-hidden="true">⬡</div>
          <p>暂无 MCP 服务</p>
          <span className="empty-state__hint">点击右上角「添加 MCP」创建第一个服务</span>
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
      {confirmDialog}
    </section>
  );
}
