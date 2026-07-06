import type { McpCallMetrics } from "@kako/shared";

export const EMPTY_METRICS: McpCallMetrics = {
  totalCalls: 0,
  successCount: 0,
  errorCount: 0,
  successRate: 0,
  avgDurationMs: 0,
  p99DurationMs: 0,
};

export function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function metricsRow(label: string, value: string) {
  return (
    <div className="mcp-stat">
      <span className="mcp-stat__label">{label}</span>
      <span className="mcp-stat__value">{value}</span>
    </div>
  );
}

export function MetricsBar({
  totalCalls,
  successCount,
  successRate,
  avgDurationMs,
  p99DurationMs,
}: McpCallMetrics) {
  return (
    <div className="mcp-metrics">
      {metricsRow("调用量", String(totalCalls))}
      {metricsRow("成功", String(successCount))}
      {metricsRow("成功率", pct(successRate))}
      {metricsRow("平均耗时", `${avgDurationMs}ms`)}
      {metricsRow("P99", `${p99DurationMs}ms`)}
    </div>
  );
}

export function aggregateMetrics(items: McpCallMetrics[]): McpCallMetrics {
  const totalCalls = items.reduce((sum, item) => sum + item.totalCalls, 0);
  const successCount = items.reduce((sum, item) => sum + item.successCount, 0);
  const errorCount = totalCalls - successCount;
  if (!totalCalls) return { ...EMPTY_METRICS };

  let weightedDuration = 0;
  let weightedP99 = 0;
  for (const item of items) {
    weightedDuration += item.avgDurationMs * item.totalCalls;
    weightedP99 += item.p99DurationMs * item.totalCalls;
  }

  return {
    totalCalls,
    successCount,
    errorCount,
    successRate: successCount / totalCalls,
    avgDurationMs: Math.round(weightedDuration / totalCalls),
    p99DurationMs: Math.round(weightedP99 / totalCalls),
  };
}
