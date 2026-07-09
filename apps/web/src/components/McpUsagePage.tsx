import { useEffect, useState } from "react";
import type {
  McpCallLogEntry,
  McpCallMetrics,
  McpServerMetrics,
  McpToolMetrics,
} from "@kako/shared";
import { api } from "../api";
import { CallCount, MetricsBar, pct } from "./mcp-metrics-ui";

interface McpUsagePageProps {
  globalMetrics: McpCallMetrics;
  serverUsageRows: McpServerMetrics[];
  toolUsageRows: McpToolMetrics[];
  recentLogs: McpCallLogEntry[];
  obsStats: { totalLogs: number; mcpLogs: number; dbPath: string } | null;
  serverNameById: Map<string, string>;
  loading: boolean;
  onBack: () => void;
  onRefresh: () => void;
}

export function McpUsagePage({
  globalMetrics,
  serverUsageRows,
  toolUsageRows,
  recentLogs,
  obsStats,
  serverNameById,
  loading,
  onBack,
  onRefresh,
}: McpUsagePageProps) {
  const [logFilter, setLogFilter] = useState<{ serverId: string; toolName?: string } | null>(
    null,
  );
  const [logs, setLogs] = useState<McpCallLogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<McpCallLogEntry | null>(null);

  useEffect(() => {
    if (!logFilter) {
      setLogs([]);
      return;
    }
    void api
      .getMcpLogs({
        serverId: logFilter.serverId,
        toolName: logFilter.toolName,
        limit: 50,
      })
      .then((res) => setLogs(res.logs));
  }, [logFilter]);

  return (
    <div className="form-page">
      <header className="form-page__header">
        <button type="button" className="icon-btn form-page__back" onClick={onBack}>
          ←
        </button>
        <h1>使用情况</h1>
        <div className="form-page__header-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void onRefresh()}
            disabled={loading}
          >
            刷新
          </button>
        </div>
      </header>

      <div className="form-page__body form-page__body--wide">
        <div className="mcp-usage-dashboard mcp-usage-dashboard--flat">
          {obsStats && (
            <p className="mcp-usage-dashboard__meta">
              MCP {obsStats.mcpLogs} 条 · 全部工具 {obsStats.totalLogs} 条
            </p>
          )}

          <MetricsBar {...globalMetrics} />

          <div className="mcp-usage-section">
            <h4 className="mcp-usage-section__title">MCP 服务</h4>
            {serverUsageRows.length === 0 ? (
              <p className="mcp-hint">暂无 MCP 服务，添加后 Agent 调用工具时此处会显示统计。</p>
            ) : (
              <table className="mcp-usage-table">
                <thead>
                  <tr>
                    <th>服务</th>
                    <th>调用量</th>
                    <th>成功</th>
                    <th>失败</th>
                    <th>成功率</th>
                    <th>平均耗时</th>
                    <th>P99</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {serverUsageRows.map((row) => (
                    <tr key={row.serverId}>
                      <td className="mcp-usage-table__name">{row.serverName}</td>
                      <td>
                        <CallCount count={row.totalCalls} />
                      </td>
                      <td>{row.successCount}</td>
                      <td>{row.errorCount}</td>
                      <td>{pct(row.successRate)}</td>
                      <td>{row.avgDurationMs}ms</td>
                      <td>{row.p99DurationMs}ms</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setLogFilter({ serverId: row.serverId })}
                        >
                          日志
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="mcp-usage-section">
            <h4 className="mcp-usage-section__title">工具调用</h4>
            {toolUsageRows.length === 0 ? (
              <p className="mcp-hint">暂无工具调用记录。</p>
            ) : (
              <table className="mcp-usage-table">
                <thead>
                  <tr>
                    <th>服务</th>
                    <th>工具</th>
                    <th>调用量</th>
                    <th>成功率</th>
                    <th>平均耗时</th>
                    <th>P99</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {toolUsageRows.map((row) => (
                    <tr key={`${row.serverId}::${row.toolName}`}>
                      <td>{row.serverName}</td>
                      <td className="mcp-usage-table__name">{row.toolName}</td>
                      <td>
                        <CallCount count={row.totalCalls} />
                      </td>
                      <td>{pct(row.successRate)}</td>
                      <td>{row.avgDurationMs}ms</td>
                      <td>{row.p99DurationMs}ms</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() =>
                            setLogFilter({ serverId: row.serverId, toolName: row.toolName })
                          }
                        >
                          日志
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {logFilter && (
            <div className="mcp-usage-section mcp-logs">
              <div className="mcp-logs__header">
                <h4 className="mcp-usage-section__title">
                  调用日志
                  {logFilter.toolName ? ` · ${logFilter.toolName}` : ""}
                </h4>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setLogFilter(null)}
                >
                  关闭
                </button>
              </div>
              {logs.length === 0 ? (
                <p className="mcp-hint">暂无调用记录</p>
              ) : (
                <table className="mcp-logs-table">
                  <colgroup>
                    <col className="mcp-logs-table__col-time" />
                    <col className="mcp-logs-table__col-status" />
                    <col className="mcp-logs-table__col-duration" />
                    <col />
                    <col className="mcp-logs-table__col-action" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>状态</th>
                      <th>耗时</th>
                      <th>工具</th>
                      <th className="mcp-logs-table__action" aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.toolUseId}>
                        <td className="mcp-logs-table__time">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="mcp-logs-table__status">
                          <span
                            className={`tag ${log.status === "success" ? "tag--active" : "tag--warn"}`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="mcp-logs-table__duration">{log.durationMs}ms</td>
                        <td className="mcp-logs-table__tool" title={log.mcpToolName}>
                          {log.mcpToolName}
                        </td>
                        <td className="mcp-logs-table__action">
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setSelectedLog(log)}
                          >
                            详情
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="mcp-usage-section">
            <h4 className="mcp-usage-section__title">最近调用</h4>
            {recentLogs.length === 0 ? (
              <p className="mcp-hint">
                暂无调用记录。通过 Agent 对话触发 MCP 工具后，数据会写入本地数据库并显示在此。
              </p>
            ) : (
              <table className="mcp-logs-table">
                <colgroup>
                  <col className="mcp-logs-table__col-time" />
                  <col className="mcp-logs-table__col-service" />
                  <col />
                  <col className="mcp-logs-table__col-status" />
                  <col className="mcp-logs-table__col-duration" />
                  <col className="mcp-logs-table__col-action" />
                </colgroup>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>服务</th>
                    <th>工具</th>
                    <th>状态</th>
                    <th>耗时</th>
                    <th className="mcp-logs-table__action" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {recentLogs.map((log) => (
                    <tr key={log.toolUseId}>
                      <td className="mcp-logs-table__time">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="mcp-logs-table__service">
                        {serverNameById.get(log.mcpServerId) ?? log.mcpServerId}
                      </td>
                      <td className="mcp-logs-table__tool" title={log.mcpToolName}>
                        {log.mcpToolName}
                      </td>
                      <td className="mcp-logs-table__status">
                        <span
                          className={`tag ${log.status === "success" ? "tag--active" : "tag--warn"}`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="mcp-logs-table__duration">{log.durationMs}ms</td>
                      <td className="mcp-logs-table__action">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setSelectedLog(log)}
                        >
                          详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {selectedLog && (
        <div className="modal-overlay" onClick={() => setSelectedLog(null)}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>调用详情</h2>
              <button type="button" className="icon-btn" onClick={() => setSelectedLog(null)}>
                ✕
              </button>
            </div>
            <div className="modal__body mcp-log-detail">
              <div className="mcp-log-detail__meta">
                <span>{new Date(selectedLog.timestamp).toLocaleString()}</span>
                <span
                  className={`tag ${selectedLog.status === "success" ? "tag--active" : "tag--warn"}`}
                >
                  {selectedLog.status}
                </span>
                <span>{selectedLog.durationMs}ms</span>
                <span>{selectedLog.mcpToolName}</span>
              </div>
              <label className="field">
                <span className="field__label">请求参数</span>
                <pre className="mcp-log-detail__json">
                  {JSON.stringify(selectedLog.input, null, 2)}
                </pre>
              </label>
              <label className="field">
                <span className="field__label">返回结果</span>
                <pre className="mcp-log-detail__json">
                  {typeof selectedLog.output === "string"
                    ? selectedLog.output
                    : JSON.stringify(selectedLog.output ?? null, null, 2)}
                </pre>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
