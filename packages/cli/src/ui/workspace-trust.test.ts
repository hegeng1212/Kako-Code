import { describe, expect, it } from "vitest";
import { ansi, stripAnsi } from "./ansi.js";
import {
  renderWorkspaceTrustPrompt,
  trustPromptContentLineCount,
} from "./workspace-trust.js";

describe("renderWorkspaceTrustPrompt", () => {
  it("shows accessing workspace heading, path, options, and footer", () => {
    const plain = stripAnsi(renderWorkspaceTrustPrompt("/tmp/demo-app", 0));
    expect(plain).toContain("Accessing workspace:");
    expect(plain).toContain("/tmp/demo-app");
    expect(plain).toContain("Yes, I trust this folder");
    expect(plain).toContain("No, exit");
    expect(plain).toContain("Kako will be able to read, edit, and execute files here.");
    expect(plain).toContain("Enter to confirm");
    expect(plain).toContain("Esc to cancel");
    expect(plain).toMatch(/^─+/m);
  });

  it("marks the selected option with a cursor prefix", () => {
    const plain = stripAnsi(renderWorkspaceTrustPrompt("/tmp/demo-app", 1));
    expect(plain).toMatch(/>\s*2\.\s*No, exit/);
    expect(plain).toMatch(/^\s+1\.\s*Yes, I trust this folder/m);
  });

  it("styles path in light blue and selected option in accent", () => {
    const selectedYes = renderWorkspaceTrustPrompt("/tmp/demo-app", 0);
    expect(selectedYes).toContain(`${ansi.blue}${ansi.bold}/tmp/demo-app${ansi.reset}`);
    expect(selectedYes).toContain(`${ansi.yellow}`);
    expect(selectedYes).toContain(`${ansi.accent}1. Yes, I trust this folder${ansi.reset}`);
    expect(selectedYes).toContain(`${ansi.muted}2. No, exit${ansi.reset}`);

    const selectedNo = renderWorkspaceTrustPrompt("/tmp/demo-app", 1);
    expect(selectedNo).toContain(`${ansi.muted}1. Yes, I trust this folder${ansi.reset}`);
    expect(selectedNo).toContain(`${ansi.accent}2. No, exit${ansi.reset}`);
  });

  it("counts content lines without inflating trailing newline", () => {
    const a = renderWorkspaceTrustPrompt("/tmp/demo-app", 0);
    const b = renderWorkspaceTrustPrompt("/tmp/demo-app", 1);
    expect(a.endsWith("\n")).toBe(true);
    expect(trustPromptContentLineCount(a)).toBe(trustPromptContentLineCount(b));
    expect(trustPromptContentLineCount(a)).toBeLessThan(a.split("\n").length);
  });
});
