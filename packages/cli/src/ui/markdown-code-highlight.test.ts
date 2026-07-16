import { describe, expect, it } from "vitest";
import { ansi, stripAnsi } from "./ansi.js";
import { clipToDisplayWidth, highlightCodeLine } from "./markdown-code-highlight.js";

describe("markdown-code-highlight", () => {
  it("clips by display width for CJK", () => {
    expect(clipToDisplayWidth("你好世界", 4)).toBe("你好");
  });

  it("colors Go keywords and function calls with Dark+ roles", () => {
    const line = highlightCodeLine("func Completion(ctx context.Context) error {", "go");
    expect(line).toContain("\x1b[38;5;75m"); // keyword
    expect(line).toContain("\x1b[38;5;187m"); // function
    expect(stripAnsi(line)).toContain("Completion");
  });

  it("colors JSON keys, strings, and booleans with Dark+ roles", () => {
    const line = highlightCodeLine('  "stream": true,', "json");
    expect(line).toContain("\x1b[38;5;117m"); // key
    expect(line).toContain("\x1b[38;5;75m"); // boolean
  });

  it("keeps documentation list ordinals white inside fenced code", () => {
    const line = highlightCodeLine("1. HTTP 请求进入 (router.go:37)", "go");
    expect(line).toContain(`${ansi.text}1.`);
    expect(line).not.toContain("\x1b[38;5;151m1\x1b[0m.");
  });

  it("clips ANSI text without dropping colors", async () => {
    const { clipAnsiToDisplayWidth } = await import("./markdown-code-highlight.js");
    const colored = `${ansi.blue}abcdef${ansi.reset}`;
    const clipped = clipAnsiToDisplayWidth(colored, 3);
    expect(clipped).toContain(ansi.blue);
    expect(stripAnsi(clipped)).toBe("abc");
  });
});
