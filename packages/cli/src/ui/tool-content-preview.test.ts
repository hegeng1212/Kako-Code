import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import {
  applyEditPreview,
  buildCompactDiffRows,
  computeUnifiedLineDiff,
  countEditDiffStats,
  countSourceLines,
  isCodeFilePath,
  reconstructBeforeEdit,
  renderFoldableCodeLines,
  renderFoldableDiffLines,
  renderFilePreviewLines,
  renderPlainTextPreviewLines,
} from "./tool-content-preview.js";
import {
  fileLineChangeStatsFromEntry,
  renderEditToolLines,
  renderFileLineChangeSuffix,
  renderWriteToolInvocationLine,
  renderWriteToolLines,
  type ToolCallTimelineEntry,
} from "./tool-call-display.js";
import { ansi } from "./ansi.js";

describe("tool-content-preview", () => {
  it("counts source lines", () => {
    expect(countSourceLines("a\nb\nc")).toBe(3);
    expect(countSourceLines("")).toBe(0);
  });

  it("reconstructs file content before edit", () => {
    const after = "a\nnew\nb";
    expect(reconstructBeforeEdit(after, "old", "new")).toBe("a\nold\nb");
  });

  it("computes unified diff stats", () => {
    const before = "keep\nold\nkeep2";
    const after = "keep\nnew\nkeep2";
    expect(countEditDiffStats(before, after)).toEqual({ added: 1, removed: 1 });
  });

  it("includes context lines in unified diff", () => {
    const diff = computeUnifiedLineDiff("a\nb\nc", "a\nB\nc");
    expect(diff.some((d) => d.kind === "context" && d.text === "a")).toBe(true);
    expect(diff.some((d) => d.kind === "remove" && d.text === "b")).toBe(true);
    expect(diff.some((d) => d.kind === "add" && d.text === "B")).toBe(true);
    expect(diff.some((d) => d.kind === "context" && d.text === "c")).toBe(true);
  });

  it("renders foldable code with truncation hint", () => {
    const source = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n");
    const lines = renderFoldableCodeLines(source, 100, { collapsed: true, indent: 4 });
    expect(lines.length).toBe(11);
    expect(stripAnsi(lines[lines.length - 1]!)).toContain("+5 lines");
  });

  it("renders unified diff with full-width background cells", () => {
    const lines = renderFoldableDiffLines("old", "new", 100, {
      expanded: true,
      indent: 4,
    });
    const joined = lines.join("\n");
    expect(joined).toContain("\x1b[48;5;52m");
    expect(joined).toContain("\x1b[48;5;22m");
    expect(stripAnsi(joined)).toContain("-old");
    expect(stripAnsi(joined)).toContain("+new");
  });

  it("leaves unchanged diff context lines without a filled background", () => {
    const lines = renderFoldableDiffLines("keep\nold\nkeep2", "keep\nnew\nkeep2", 100, {
      expanded: true,
      indent: 0,
    });
    const contextLine = lines.find((line) => stripAnsi(line).includes("keep") && !line.includes("-") && !line.includes("+"))!;
    expect(contextLine).toBeDefined();
    expect(contextLine).not.toContain("\x1b[48;5;236m");
    expect(contextLine).not.toContain("\x1b[48;5;22m");
    expect(contextLine).not.toContain("\x1b[48;5;52m");
  });

  it("uses bright gutter colors and aligned widths on add/remove rows", () => {
    const lines = renderFoldableDiffLines("alpha\nold\nbeta", "alpha\nnew\nbeta", 80, {
      expanded: true,
      indent: 0,
    });
    const removeLine = lines.find((line) => stripAnsi(line).includes("-old"))!;
    const addLine = lines.find((line) => stripAnsi(line).includes("+new"))!;
    expect(removeLine).toContain("\x1b[38;5;203m");
    expect(addLine).toContain("\x1b[38;5;77m");
    const widths = lines.map((line) => stripAnsi(line).length);
    expect(new Set(widths).size).toBe(1);
  });

  it("applies edit preview replacements", () => {
    expect(applyEditPreview("a\nold\nb", "old", "new")).toBe("a\nnew\nb");
  });

  it("classifies code vs document paths", () => {
    expect(isCodeFilePath("/tmp/add.py")).toBe(true);
    expect(isCodeFilePath("/tmp/report.md")).toBe(false);
    expect(isCodeFilePath("/tmp/spec.prd")).toBe(false);
    expect(isCodeFilePath("/tmp/notes.txt")).toBe(false);
    expect(isCodeFilePath("Dockerfile")).toBe(true);
  });

  it("renders plain text preview without diff backgrounds", () => {
    const lines = renderPlainTextPreviewLines("# Title\n\nBody", 80, { collapsed: false });
    const joined = lines.join("\n");
    expect(joined).toContain("# Title");
    expect(joined).not.toContain("\x1b[48;5;22m");
    expect(joined).not.toContain("+");
  });

  it("folds unchanged regions in compact diff view", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const after = `${before}\nnew tail`;
    const rows = buildCompactDiffRows(computeUnifiedLineDiff(before, after), 3);
    expect(rows.some((r) => r.type === "fold" && r.count > 0)).toBe(true);
    const lines = renderFoldableDiffLines(before, after, 100, { indent: 0 });
    const plain = lines.map((l) => stripAnsi(l)).join("\n");
    expect(plain).toContain("unchanged lines");
    expect(plain).toContain("+new tail");
    expect(plain).not.toMatch(/│\s*1 /);
  });

  it("uses diff styling only for code files", () => {
    const md = renderFilePreviewLines("", "# Title", 80, {
      filePath: "/tmp/report.md",
    });
    expect(md.join("\n")).not.toContain("\x1b[48;5;22m");

    const py = renderFilePreviewLines("", "print('hi')", 80, {
      filePath: "/tmp/add.py",
    });
    expect(py.join("\n")).toContain("\x1b[48;5;22m");
  });
});

function entry(overrides: Partial<ToolCallTimelineEntry> = {}): ToolCallTimelineEntry {
  return {
    type: "tool",
    id: "tool-1",
    name: "Write",
    detail: "/tmp/add.py",
    status: "success",
    dotFrame: 0,
    ...overrides,
  };
}

describe("write/edit tool display", () => {
  it("renders Write header with basename and line stats", () => {
    const text = stripAnsi(
      renderWriteToolLines(
        entry({
          toolInput: { content: "def add(a, b):\n    return a + b\n" },
        }),
        120,
        6,
        false,
      ).join("\n"),
    );
    expect(text).toContain("Write(add.py)");
    expect(text).toContain("+3");
    expect(text).not.toContain("Wrote 3 lines");
    expect(text).toContain("def add");
  });

  it("renders Write markdown without line stats on header", () => {
    const rendered = renderWriteToolLines(
      entry({
        detail: "/tmp/report.md",
        toolInput: { content: "# Title\n\nBody\n" },
      }),
      120,
      6,
      false,
    );
    const text = stripAnsi(rendered.join("\n"));
    expect(text).toContain("Write(report.md)");
    expect(text).not.toMatch(/\+|\-/);
    expect(text).not.toContain("Wrote 4 lines");
    expect(text).not.toContain("# Title");
    expect(rendered.join("\n")).not.toContain("\x1b[48;5;22m");
  });

  it("renders Write overwrite as Update with compact diff by default", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const after = `${before}\nnew tail`;
    const text = stripAnsi(
      renderWriteToolLines(
        entry({
          priorContent: before,
          toolInput: { content: after },
          output: after,
        }),
        120,
        6,
        false,
      ).join("\n"),
    );
    expect(text).toContain("Update(add.py)");
    expect(text).toContain("+1");
    expect(text).toContain("+new tail");
    expect(text).toContain("unchanged lines");
    expect(text).not.toMatch(/│\s*1 /);
  });

  it("renders Write overwrite with full diff when expanded", () => {
    const before = "alpha\nold\nbeta";
    const after = "alpha\nnew\nbeta";
    const text = stripAnsi(
      renderWriteToolLines(
        entry({
          priorContent: before,
          toolInput: { content: after },
          output: after,
        }),
        120,
        6,
        true,
      ).join("\n"),
    );
    expect(text).toContain("-old");
    expect(text).toContain("+new");
    expect(text).toContain("alpha");
  });

  it("renders Edit header with Update label and compact diff stats", () => {
    const text = stripAnsi(
      renderEditToolLines(
        entry({
          name: "Edit",
          toolInput: { old_string: "x = 1", new_string: "x = 10" },
          output: "x = 10\ny = 2",
        }),
        120,
        6,
        false,
      ).join("\n"),
    );
    expect(text).toContain("Update(add.py)");
    expect(text).toContain("+1");
    expect(text).toContain("-1");
    expect(text).toContain("-x = 1");
    expect(text).toContain("+x = 10");
  });

  it("shows approval dot on first-level Edit header when required", () => {
    const rendered = renderEditToolLines(
      entry({
        name: "Edit",
        approvalRequired: true,
        approvalGranted: true,
        toolInput: { old_string: "a", new_string: "b" },
        output: "b",
      }),
      120,
      6,
      true,
    )[0]!;
    expect(rendered).toContain("⏺");
    expect(stripAnsi(rendered)).toContain("Update(add.py)");
  });

  it("colors added and removed line stats on file tool headers", () => {
    const suffix = renderFileLineChangeSuffix({ added: 3, removed: 2 });
    expect(suffix).toContain(`${ansi.diffAdd}+3${ansi.reset}`);
    expect(suffix).toContain(`${ansi.diffRemove}-2${ansi.reset}`);
    const stats = fileLineChangeStatsFromEntry(
      entry({
        priorContent: "old\n",
        toolInput: { content: "new\n" },
        output: "new\n",
      }),
    );
    expect(stats).toEqual({ added: 1, removed: 1 });
  });

  it("omits line stats for markdown and other non-code files", () => {
    const stats = fileLineChangeStatsFromEntry(
      entry({
        detail: "/tmp/report.md",
        toolInput: { content: "# Title\n\nBody\n" },
        output: "# Title\n\nBody\n",
      }),
    );
    expect(stats).toBeNull();
    const header = stripAnsi(
      renderWriteToolInvocationLine(
        entry({
          detail: "/tmp/report.md",
          status: "success",
          toolInput: { content: "# Title\n\nBody\n" },
          output: "# Title\n\nBody\n",
        }),
      ),
    );
    expect(header).toBe("Write(report.md)");
    expect(header).not.toMatch(/\+|\-/);
  });
});
