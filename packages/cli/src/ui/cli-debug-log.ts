import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getKakoHome, KAKO_CORE_VERSION, setCoreDebugSink } from "@kako/core";

let enabled = false;
let processHandlersRegistered = false;

/** `~/.kako/debug.log` (or `$KAKO_HOME/debug.log`). */
export function getCliDebugLogPath(): string {
  return join(getKakoHome(), "debug.log");
}

/** Same as {@link getCliDebugLogPath}; use the function when KAKO_HOME may change (tests). */
export const CLI_DEBUG_LOG_PATH = join(getKakoHome(), "debug.log");

function escapeChunk(chunk: string): string {
  return JSON.stringify(
    chunk.replace(/[\u0000-\u001f\u007f]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return `\\x${code.toString(16).padStart(2, "0")}`;
    }),
  );
}

function hexChunk(chunk: string): string {
  return Buffer.from(chunk, "utf8").toString("hex");
}

function writeLine(line: string): void {
  if (!enabled) return;
  try {
    const path = getCliDebugLogPath();
    mkdirSync(dirname(path), { recursive: true });
    // File only — never console.error here. stderr corrupts the raw-mode TUI
    // (mouse scroll/click would paint JSON over the chat).
    appendFileSync(path, line, "utf8");
  } catch {
    // Ignore logging failures — never break chat.
  }
}

export function isCliDebugEnabled(): boolean {
  return enabled;
}

export function enableCliDebug(): void {
  enabled = true;
  setCoreDebugSink((tag, data) => {
    debugLog(tag, data);
  });
  const path = getCliDebugLogPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    // Append across CLI restarts so a later `--debug` session still has prior context.
    const header =
      `${new Date().toISOString()} [cli-debug:session] ` +
      `${JSON.stringify({
        pid: process.pid,
        cwd: process.cwd(),
        version: KAKO_CORE_VERSION,
      })}\n`;
    appendFileSync(path, header, "utf8");
  } catch {
    // ignore
  }
  console.error(`[kako] debug log: ${path}`);

  if (!processHandlersRegistered) {
    processHandlersRegistered = true;
    process.on("uncaughtException", (err) => {
      debugError("process:uncaughtException", {
        err: `${err.name}: ${err.message}`,
        stack: err.stack?.split("\n").slice(0, 12).join(" | "),
      });
    });
    process.on("unhandledRejection", (reason) => {
      debugError("process:unhandledRejection", {
        reason:
          reason instanceof Error
            ? `${reason.name}: ${reason.message}`
            : String(reason),
        stack:
          reason instanceof Error
            ? reason.stack?.split("\n").slice(0, 12).join(" | ")
            : undefined,
      });
    });
  }
}

/** Test helper — disables logging; does not remove process listeners. */
export function resetCliDebugForTests(): void {
  enabled = false;
  setCoreDebugSink(null);
}

export function debugLog(tag: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  const payload = data ? ` ${JSON.stringify(data)}` : "";
  writeLine(`${new Date().toISOString()} [${tag}]${payload}\n`);
}

export function debugError(tag: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  const payload = data ? ` ${JSON.stringify(data)}` : "";
  writeLine(`${new Date().toISOString()} [ERROR ${tag}]${payload}\n`);
}

export function debugChunk(
  tag: string,
  chunk: string,
  extra?: Record<string, unknown>,
): void {
  // Mouse / focus CSI floods on scroll+click; keep those out of debug.log noise.
  if (isMouseOrFocusCsi(chunk)) return;
  debugLog(tag, {
    ...extra,
    len: chunk.length,
    escape: escapeChunk(chunk),
    hex: hexChunk(chunk),
  });
}

/** True for SGR/X10 mouse reports and focus-in/out (ESC [ I/O). */
export function isMouseOrFocusCsi(chunk: string): boolean {
  if (!chunk.includes("\u001b")) return false;
  // SGR mouse: CSI < btn ; x ; y M|m
  if (chunk.includes("\u001b[<")) return true;
  // X10 mouse: CSI M Cb Cx Cy
  if (chunk.includes("\u001b[M")) return true;
  // Focus in/out when DECSET 1004 is on
  if (chunk === "\u001b[I" || chunk === "\u001b[O") return true;
  return false;
}

export function debugStack(tag: string, data?: Record<string, unknown>): void {
  const err = new Error(tag);
  debugLog(tag, {
    ...data,
    stack: err.stack?.split("\n").slice(1, 8).join(" | "),
  });
}
