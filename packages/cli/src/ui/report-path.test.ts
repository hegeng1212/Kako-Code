import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import {
  containingDirectory,
  isReportArtifactPath,
  OPEN_REPORT_DIR_LABEL,
  truncatePathForDisplay,
} from "./report-path.js";
import { expandReportArtifactParts, parseInlineParts, wrapInlinePartsDetailed } from "./markdown-inline.js";
import { renderAnswerTextRenderLines } from "./chat-blocks.js";
import { renderRichContentLineObjects } from "./markdown-render.js";

describe("report-path", () => {
  it("classifies report artifacts by extension, not code sources", () => {
    expect(isReportArtifactPath("/tmp/report.md")).toBe(true);
    expect(isReportArtifactPath("/tmp/deck.pptx")).toBe(true);
    expect(isReportArtifactPath("/tmp/sheet.xlsx")).toBe(true);
    expect(isReportArtifactPath("/tmp/spec.prd")).toBe(true);
    expect(isReportArtifactPath("/tmp/main.ts")).toBe(false);
    expect(isReportArtifactPath("/tmp/lib.go")).toBe(false);
  });

  it("truncates long paths while keeping the basename when possible", () => {
    const path =
      "/Users/hegeng/.kako/memory/sessions/sess-8e2b6df7/reports/中国K12投资研究报告-2024-2026.md";
    const shown = truncatePathForDisplay(path, 40);
    expect(shown.startsWith("…/")).toBe(true);
    expect(shown.endsWith(".md")).toBe(true);
    expect(shown.length).toBeLessThan(path.length);
  });
});

describe("report path open-dir UI", () => {
  it("appends 打开目录 for report paths and keeps code paths plain", () => {
    const report =
      "`/Users/hegeng/.kako/memory/sessions/sess-1/reports/行业报告-2024.md`";
    const code = "`/Users/hegeng/proj/src/main.ts`";
    const reportLines = wrapInlinePartsDetailed(parseInlineParts(report), 48);
    const codeLines = wrapInlinePartsDetailed(parseInlineParts(code), 48);
    const reportPlain = reportLines.map((l) => stripAnsi(l.text)).join("");
    const codePlain = codeLines.map((l) => stripAnsi(l.text)).join("");
    expect(reportPlain).toContain(OPEN_REPORT_DIR_LABEL);
    expect(reportLines.some((l) => l.openDir)).toBe(true);
    expect(codePlain).not.toContain(OPEN_REPORT_DIR_LABEL);
    expect(codeLines.every((l) => !l.openDir)).toBe(true);
  });

  it("keeps a long report path on one visual row via truncation", () => {
    const path =
      "/Users/hegeng/.kako/memory/sessions/sess-8e2b6df7/reports/中国K12学科教育行业投资研究报告-2024-2026.md";
    const text = `报告已保存至：\`${path}\``;
    const lines = renderRichContentLineObjects(text, 56);
    const withLink = lines.filter((l) => l.openDir);
    expect(withLink.length).toBe(1);
    expect(stripAnsi(withLink[0]!.text)).toContain(OPEN_REPORT_DIR_LABEL);
    expect(withLink[0]!.openDir).toBe(containingDirectory(path));
    // Truncated path + link should fit without mid-path terminal wrap for this width.
    expect(withLink).toHaveLength(1);
  });

  it("does not pulse answer body when streaming (static bullet)", () => {
    const text = "你好！当前后台正在生成报告…";
    const a = renderAnswerTextRenderLines(text, 80);
    const b = renderAnswerTextRenderLines(text, 80);
    expect(a.map((l) => l.text)).toEqual(b.map((l) => l.text));
    expect(stripAnsi(a[0]!.text)).toContain("你好");
  });

  it("expandReportArtifactParts leaves non-path parts alone", () => {
    const parts = parseInlineParts("see main.ts later");
    expect(expandReportArtifactParts(parts, 40)).toEqual(parts);
  });
});
