import { describe, expect, it } from "vitest";
import { displayWidth } from "./ansi.js";
import { KAKO_DINO_MINI } from "./mascot.js";
import {
  COMPACT_HEADER_MAX_ROWS,
  renderChatHeader,
  renderMiniHeader,
  renderWelcomeScreen,
  resolveEffectiveHeaderMode,
  shouldUseCompactHeader,
  stripAnsi,
} from "./welcome.js";
import { ansi } from "./ansi.js";

const SAMPLE_OPTS = {
  version: "0.2.0",
  agentName: "main",
  modelLabel: "GPT-4o",
  cwd: "/Users/me/myproject",
  contextPath: "/Users/me/myproject/KAKO.md",
  sessionId: "sess-abc12345",
  sessionLabel: "main agent · new session",
  dataDir: "/Users/me/.kako",
};

describe("renderWelcomeScreen", () => {
  it("renders Claude-style boxed welcome", () => {
    const screen = renderWelcomeScreen(SAMPLE_OPTS);

    const plain = stripAnsi(screen);
    expect(plain).toContain("Kako v0.2.0");
    expect(plain).toContain("Welcome back!");
    expect(plain).toContain("◉");
    expect(plain).toContain("GPT-4o");
    expect(plain).not.toContain("OpenAI");
    expect(plain).toContain("Tips for getting started");
    expect(plain).toContain("What's new");
    expect(plain).toContain("/help for more");
    expect(plain).toContain("myproject");
    expect(plain).toContain("┌");
    expect(plain).toContain("┐");
    expect(plain).toContain("│");
    expect(plain).not.toContain("╭");

    const lines = plain.split("\n");
    const cwdRow = lines.findIndex((l) => l.includes("myproject"));
    let lastContentRow = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.includes("│") && lines[i]!.trim() !== "│") {
        lastContentRow = i;
        break;
      }
    }
    expect(cwdRow).toBeGreaterThan(0);
    expect(cwdRow).toBe(lastContentRow);
  });
});

describe("renderMiniHeader", () => {
  it("renders compact icon + metadata without box borders", () => {
    const screen = renderMiniHeader(SAMPLE_OPTS, 100);
    const plain = stripAnsi(screen);
    expect(plain).toContain("Kako");
    expect(plain).toContain("v0.2.0");
    expect(plain).toContain("GPT-4o");
    expect(plain).toContain("main agent");
    expect(plain).toContain("myproject");
    expect(plain).toContain("■");
    expect(plain).not.toContain("Welcome back!");
    expect(plain).not.toContain("┌");
    expect(plain.split("\n").length).toBeLessThan(8);
  });

  it("uses bold title and muted version like Claude Code", () => {
    const screen = renderMiniHeader(SAMPLE_OPTS, 100);
    expect(screen).toContain(`${ansi.text}${ansi.bold}Kako${ansi.reset}`);
    expect(screen).toContain(`${ansi.muted}v0.2.0${ansi.reset}`);
    expect(screen).toContain(`${ansi.muted}GPT-4o · main agent${ansi.reset}`);
  });

  it("aligns mini icon rows to the same display width", () => {
    const widths = KAKO_DINO_MINI.map((row) => displayWidth(row));
    expect(widths).toEqual([10, 10, 10]);
  });
});

describe("renderChatHeader", () => {
  it("selects standard or mini renderer by mode", () => {
    expect(stripAnsi(renderChatHeader(SAMPLE_OPTS, "standard"))).toContain("Welcome back!");
    expect(stripAnsi(renderChatHeader(SAMPLE_OPTS, "mini"))).not.toContain("Welcome back!");
  });
});

describe("resolveEffectiveHeaderMode", () => {
  it("keeps mini when preferred is mini", () => {
    expect(
      resolveEffectiveHeaderMode("mini", { rows: COMPACT_HEADER_MAX_ROWS, cols: 120 }),
    ).toBe("mini");
  });

  it("switches standard to mini on compact terminals", () => {
    expect(shouldUseCompactHeader({ rows: COMPACT_HEADER_MAX_ROWS - 1, cols: 120 })).toBe(true);
    expect(
      resolveEffectiveHeaderMode("standard", { rows: COMPACT_HEADER_MAX_ROWS - 1, cols: 120 }),
    ).toBe("mini");
  });

  it("keeps standard on tall enough terminals", () => {
    expect(shouldUseCompactHeader({ rows: COMPACT_HEADER_MAX_ROWS, cols: 120 })).toBe(false);
    expect(
      resolveEffectiveHeaderMode("standard", { rows: COMPACT_HEADER_MAX_ROWS, cols: 120 }),
    ).toBe("standard");
  });
});
