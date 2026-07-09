import { describe, expect, it } from "vitest";
import { highlightJsLine, renderScriptCodeBlock } from "./script-code-view.js";
import { stripAnsi } from "./ansi.js";

describe("script-code-view", () => {
  it("highlights keywords and strings", () => {
    const rendered = stripAnsi(highlightJsLine("export const meta = { name: 'demo' }"));
    expect(rendered).toBe("export const meta = { name: 'demo' }");
    expect(highlightJsLine("export const meta = { name: 'demo' }")).toContain("\x1b[");
  });

  it("renders numbered code block lines", () => {
    const lines = renderScriptCodeBlock("const x = 1\n// comment", 80);
    expect(lines).toHaveLength(2);
    expect(stripAnsi(lines[0]!)).toMatch(/│  1 /);
    expect(stripAnsi(lines[1]!)).toMatch(/│  2 /);
  });
});
