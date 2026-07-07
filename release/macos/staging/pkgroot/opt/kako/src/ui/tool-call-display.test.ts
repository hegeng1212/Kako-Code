import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import {
  collectActivityStats,
  renderActivitySummaryLine,
  renderPlanPreviewHint,
  renderToolCallErrorLines,
  renderToolCallStatusLine,
  renderToolInvocationLine,
  renderToolOutputLines,
  type ToolCallTimelineEntry,
} from "./tool-call-display.js";
import { toolCallStatPhrase } from "./tool-call-phrases.js";

function entry(overrides: Partial<ToolCallTimelineEntry> = {}): ToolCallTimelineEntry {
  return {
    type: "tool",
    id: "tool-1",
    name: "mcp/babytree/bbt_pregnancy.find_baby",
    detail: "{}",
    status: "waiting",
    dotFrame: 0,
    ...overrides,
  };
}

describe("tool-call-display", () => {
  it("renders waiting state with contextual phrase", () => {
    expect(stripAnsi(renderToolCallStatusLine(entry({ dotFrame: 0 })))).toBe(
      "Waiting Calling bbt_pregnancy.find_baby",
    );
    expect(
      stripAnsi(
        renderToolCallStatusLine(
          entry({ name: "Read", detail: "/tmp/a.md", dotFrame: 2 }),
        ),
      ),
    ).toBe("Waiting.. Reading /tmp/a.md");
  });

  it("renders approval prompt for confirmation-gated tools", () => {
    const text = stripAnsi(
      renderToolCallStatusLine(
        entry({
          name: "Write",
          detail: "/Users/hegeng/PRD.md",
          awaitingApproval: true,
        }),
      ),
    );
    expect(text).toContain("Approve?");
    expect(text).toContain("Write /Users/hegeng/PRD.md");
    expect(text).toContain("(y/n)");
  });

  it("renders plan write as Updated plan", () => {
    const text = stripAnsi(
      renderToolCallStatusLine(
        entry({
          name: "Write",
          detail: "/Users/me/.kako/plans/sess.md",
          status: "success",
        }),
      ),
    );
    expect(text).toContain("⏺");
    expect(text).toContain("Updated plan");
  });

  it("renders activity summary with thought time and stats", () => {
    const text = stripAnsi(renderActivitySummaryLine(10, ["listed 1 directory"], false));
    expect(text).toBe("Thought for 10s, listed 1 directory ▸ (click to expand)");
  });

  it("renders expanded tool invocation with output", () => {
    const bash = entry({
      name: "Bash",
      detail: "ls -la /tmp",
      status: "success",
      output: "total 0\ndrwxr-xr-x  3 user  staff  96 Jul  1 11:15 .",
    });
    expect(stripAnsi(renderToolInvocationLine(bash))).toBe("⏺ Bash(ls -la /tmp)");
    const lines = renderToolOutputLines(bash, 80);
    expect(lines.length).toBeGreaterThan(0);
    expect(stripAnsi(lines[0]!)).toContain("total 0");
  });

  it("collects activity stats excluding plan writes", () => {
    const stats = collectActivityStats([
      entry({ name: "Bash", detail: "ls -la", status: "success", output: "drwx\n" }),
      entry({
        name: "Write",
        detail: "/Users/me/.kako/plans/sess.md",
        status: "success",
      }),
    ]);
    expect(stats).toEqual(["listed 1 directory"]);
  });

  it("renders plan preview hint", () => {
    expect(stripAnsi(renderPlanPreviewHint())).toContain("/plan to preview");
  });

  it("renders failed state with expand hint", () => {
    const text = stripAnsi(
      renderToolCallStatusLine(
        entry({
          name: "Bash",
          detail: "curl example.com",
          status: "error",
          errorDetail: "connection refused",
          errorExpanded: false,
        }),
      ),
    );
    expect(text).toContain("Failed to run curl example.com");
    expect(text).toContain("(click to expand)");
  });

  it("renders expanded error lines", () => {
    const lines = renderToolCallErrorLines(
      entry({ status: "error", errorDetail: "boom", errorExpanded: true }),
      80,
    );
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0]!)).toContain("boom");
  });
});

describe("toolCallStatPhrase", () => {
  it("maps ls to listed N directories", () => {
    expect(
      toolCallStatPhrase(
        "Bash",
        "ls -la /tmp",
        "drwxr-xr-x  3 user  staff  96 .\ndrwxr-xr-x  5 user  staff  160 ..\ndrwxr-xr-x  2 user  staff  64 subdir",
      ),
    ).toBe("listed 1 directory");
  });

  it("returns null for plan file writes", () => {
    expect(
      toolCallStatPhrase("Write", "/Users/me/.kako/plans/abc.md", "plan body"),
    ).toBeNull();
  });
});
