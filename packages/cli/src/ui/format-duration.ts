/** Format seconds as compact h/m/s (e.g. 437 → "7m 17s", 45 → "45s"). */
export function formatDurationSeconds(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return sec > 0 ? `${s}s` : "0s";
}

export function formatDurationMs(ms: number): string {
  return formatDurationSeconds(ms / 1000);
}
