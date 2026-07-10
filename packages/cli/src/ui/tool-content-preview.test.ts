import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import {
  applyEditPreview,
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
  renderEditToolLines,
  renderWriteToolLines,
  type ToolCallTimelineEntry,
} from "./tool-call-display.js";

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
      collapsed: false,
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
      collapsed: false,
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
      collapsed: false,
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

  it("uses diff styling only for code files", () => {
    const md = renderFilePreviewLines("", "# Title", 80, {
      collapsed: false,
      filePath: "/tmp/report.md",
    });
    expect(md.join("\n")).not.toContain("\x1b[48;5;22m");

    const py = renderFilePreviewLines("", "print('hi')", 80, {
      collapsed: false,
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
  it("renders Write header with basename", () => {
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
    expect(text).toContain("Wrote 3 lines to add.py");
    expect(text).toContain("def add");
  });

  it("renders Write markdown with summary only in chat", () => {
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
    expect(text).toContain("Wrote 4 lines to report.md");
    expect(text).not.toContain("# Title");
    expect(rendered.join("\n")).not.toContain("\x1b[48;5;22m");
  });

  it("renders Write overwrite as Update with unified diff", () => {
    const text = stripAnsi(
      renderWriteToolLines(
        entry({
          priorContent: "def add(a, b):\n    return a + b\n",
          toolInput: { content: "def add(a, b, c):\n    return a + b + c\n" },
          output: "def add(a, b, c):\n    return a + b + c\n",
        }),
        120,
        6,
        false,
      ).join("\n"),
    );
    expect(text).toContain("Update(add.py)");
    expect(text).toContain("Added 2 lines, removed 2 lines");
    expect(text).toContain("-def add(a, b):");
    expect(text).toContain("+def add(a, b, c):");
  });

  it("renders Edit header with Update label and unified diff stats", () => {
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
    expect(text).toContain("Added 1 line, removed 1 line");
    expect(text).toContain("-x = 1");
    expect(text).toContain("+x = 10");
    expect(text).toContain("y = 2");
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
});
