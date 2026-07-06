import { describe, expect, it } from "vitest";
import { renderWelcomeScreen, stripAnsi } from "./welcome.js";

describe("renderWelcomeScreen", () => {
  it("renders Claude-style boxed welcome", () => {
    const screen = renderWelcomeScreen({
      version: "0.2.0",
      agentName: "main",
      modelLabel: "GPT-4o",
      cwd: "/Users/me/myproject",
      contextPath: "/Users/me/myproject/KAKO.md",
      sessionId: "sess-abc12345",
      sessionLabel: "main agent · new session",
      dataDir: "/Users/me/.kako",
    });

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
