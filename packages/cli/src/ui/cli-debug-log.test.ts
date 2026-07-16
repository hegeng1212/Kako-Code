import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  debugChunk,
  debugError,
  debugLog,
  enableCliDebug,
  getCliDebugLogPath,
  isCliDebugEnabled,
  isMouseOrFocusCsi,
  resetCliDebugForTests,
} from "./cli-debug-log.js";

const priorHome = process.env.KAKO_HOME;

describe("cli-debug-log", () => {
  let home = "";

  beforeEach(async () => {
    resetCliDebugForTests();
    home = await mkdtemp(join(tmpdir(), "kako-cli-debug-"));
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    resetCliDebugForTests();
    if (priorHome === undefined) delete process.env.KAKO_HOME;
    else process.env.KAKO_HOME = priorHome;
    await rm(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("does not write when debug is disabled", () => {
    expect(isCliDebugEnabled()).toBe(false);
    debugLog("tag", { a: 1 });
    debugError("err", { b: 2 });
    expect(getCliDebugLogPath()).toBe(join(home, "debug.log"));
    return expect(access(getCliDebugLogPath())).rejects.toThrow();
  });

  it("writes session banner to stderr but keeps log lines file-only", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logPath = getCliDebugLogPath();

    enableCliDebug();

    expect(isCliDebugEnabled()).toBe(true);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[kako] debug log: ${logPath}`),
    );

    debugLog("chatLoop:start", { cwd: "/tmp" });
    debugError("chatLoop:message:runTurnError", { err: "boom" });

    const body = await readFile(logPath, "utf8");
    expect(body).toContain("[cli-debug:session]");
    expect(body).toContain("[chatLoop:start]");
    expect(body).toContain('"/tmp"');
    expect(body).toContain("[ERROR chatLoop:message:runTurnError]");
    expect(body).toContain("boom");
    // Must not echo log lines to stderr — that paints over the TUI.
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining("[chatLoop:start]"));
    expect(errSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("[ERROR chatLoop:message:runTurnError]"),
    );
  });

  it("appends a new session header on each enable instead of truncating", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logPath = getCliDebugLogPath();
    enableCliDebug();
    debugLog("first", { n: 1 });
    enableCliDebug();
    debugLog("second", { n: 2 });
    const body = await readFile(logPath, "utf8");
    const headers = body.match(/\[cli-debug:session\]/g) ?? [];
    expect(headers).toHaveLength(2);
    expect(body).toContain("[first]");
    expect(body).toContain("[second]");
  });

  it("skips mouse and focus CSI in debugChunk", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    enableCliDebug();
    expect(isMouseOrFocusCsi("\u001b[<64;10;20M")).toBe(true);
    expect(isMouseOrFocusCsi("\u001b[M abc")).toBe(true);
    expect(isMouseOrFocusCsi("\u001b[I")).toBe(true);
    expect(isMouseOrFocusCsi("\r")).toBe(false);
    debugChunk("onInput", "\u001b[<64;10;20M");
    debugChunk("onInput", "hello\r");
    const body = await readFile(getCliDebugLogPath(), "utf8");
    expect(body).not.toContain("<64;10;20M");
    expect(body).toContain("[onInput]");
    expect(body).toContain("hello");
  });
});
