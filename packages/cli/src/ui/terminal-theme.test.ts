import { afterEach, describe, expect, it } from "vitest";
import { ansi, initTerminalTheme } from "./ansi.js";
import { detectTerminalTheme, getTerminalTheme } from "./terminal-theme.js";

const ENV_KEYS = ["KAKO_THEME", "COLORFGBG"] as const;

function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("terminal-theme", () => {
  const saved = saveEnv();

  afterEach(() => {
    restoreEnv(saved);
    initTerminalTheme("dark");
  });

  it("respects KAKO_THEME override", () => {
    process.env.KAKO_THEME = "light";
    expect(detectTerminalTheme()).toBe("light");
    process.env.KAKO_THEME = "dark";
    expect(detectTerminalTheme()).toBe("dark");
  });

  it("detects light background from COLORFGBG", () => {
    delete process.env.KAKO_THEME;
    process.env.COLORFGBG = "0;15";
    expect(detectTerminalTheme()).toBe("light");
    process.env.COLORFGBG = "0;252";
    expect(detectTerminalTheme()).toBe("light");
  });

  it("detects dark background from COLORFGBG", () => {
    delete process.env.KAKO_THEME;
    process.env.COLORFGBG = "15;0";
    expect(detectTerminalTheme()).toBe("dark");
  });

  it("applies light palette with readable text and borders", () => {
    initTerminalTheme("light");
    expect(getTerminalTheme()).toBe("light");
    expect(ansi.text).toBe("\x1b[38;5;237m");
    expect(ansi.muted).toBe("\x1b[38;5;239m");
    expect(ansi.tableBorder).toBe("\x1b[38;5;238m");
    expect(ansi.userMessageBg).toBe("\x1b[48;5;254m");
    expect(ansi.codeBg).toBe("\x1b[48;5;253m");
  });

  it("applies dark palette by default", () => {
    initTerminalTheme("dark");
    expect(ansi.text).toBe("\x1b[38;5;255m");
    expect(ansi.codeBg).toBe("\x1b[48;5;236m");
  });
});
