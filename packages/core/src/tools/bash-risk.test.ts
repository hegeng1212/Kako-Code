import { describe, expect, it } from "vitest";
import { isLowRiskBashCommand } from "./bash-risk.js";

describe("isLowRiskBashCommand", () => {
  it("treats read-only inspection commands as low risk", () => {
    expect(isLowRiskBashCommand("ls -la")).toBe(true);
    expect(isLowRiskBashCommand("cat report.md")).toBe(true);
    expect(isLowRiskBashCommand("mkdir -p output")).toBe(true);
    expect(isLowRiskBashCommand("git status")).toBe(true);
    expect(isLowRiskBashCommand("pwd")).toBe(true);
    expect(isLowRiskBashCommand("pwd && ls ..")).toBe(true);
    expect(isLowRiskBashCommand("pwd; ls -la")).toBe(true);
    expect(isLowRiskBashCommand("ls | head -20")).toBe(true);
    expect(isLowRiskBashCommand("git status && git diff")).toBe(true);
  });

  it("treats destructive or compound commands as high risk", () => {
    expect(isLowRiskBashCommand("rm -rf tmp")).toBe(false);
    expect(isLowRiskBashCommand("python add.py")).toBe(false);
    expect(isLowRiskBashCommand("ls && rm x")).toBe(false);
    expect(isLowRiskBashCommand("pwd && python add.py")).toBe(false);
    expect(isLowRiskBashCommand("echo hi > out.txt")).toBe(false);
    expect(isLowRiskBashCommand("curl https://example.com")).toBe(false);
    expect(isLowRiskBashCommand("find . -name '*.tmp' -delete")).toBe(false);
    expect(isLowRiskBashCommand("pwd &")).toBe(false);
  });
});
