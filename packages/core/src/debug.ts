/** Optional diagnostic sink for `--debug` (wired from CLI). Never throws. */

export type CoreDebugSink = (tag: string, data?: Record<string, unknown>) => void;

let sink: CoreDebugSink | null = null;

export function setCoreDebugSink(next: CoreDebugSink | null): void {
  sink = next;
}

export function coreDebug(tag: string, data?: Record<string, unknown>): void {
  if (!sink) return;
  try {
    sink(tag, data);
  } catch {
    // never break the agent on logging
  }
}

export function coreDebugError(tag: string, data?: Record<string, unknown>): void {
  coreDebug(`ERROR ${tag}`, data);
}
