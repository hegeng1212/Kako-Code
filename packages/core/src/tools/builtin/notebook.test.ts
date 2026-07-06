import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyNotebookEdit,
  cellId,
  findCellIndex,
  formatNotebookForRead,
  parseNotebookDocument,
} from "./notebook.js";
import { withTempDir } from "./test-helpers.js";

const SAMPLE_NOTEBOOK = {
  cells: [
    { cell_type: "markdown", id: "md-1", source: "# Title\n" },
    { cell_type: "code", id: "code-1", source: "print(1)\n", outputs: [{ text: "1" }], execution_count: 1 },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
};

describe("formatNotebookForRead", () => {
  it("renders cells with id tags", () => {
    const out = formatNotebookForRead(JSON.stringify(SAMPLE_NOTEBOOK), 1, 2000);
    expect(out).toContain('<cell id="md-1">');
    expect(out).toContain('[markdown] # Title');
    expect(out).toContain('<cell id="code-1">');
    expect(out).toContain('[code] print(1)');
    expect(out).toContain('[code output]');
  });

  it("falls back to cell-N ids when missing", () => {
    const nb = { cells: [{ cell_type: "markdown", source: "hi" }] };
    const out = formatNotebookForRead(JSON.stringify(nb), 1, 2000);
    expect(out).toContain('<cell id="cell-0">');
  });
});

describe("applyNotebookEdit", () => {
  it("replaces a cell by id", () => {
    const nb = parseNotebookDocument(JSON.stringify(SAMPLE_NOTEBOOK));
    const { notebook, summary } = applyNotebookEdit(nb, {
      editMode: "replace",
      cellId: "code-1",
      newSource: "print(2)",
    });
    expect(summary).toContain("Replaced cell");
    expect(notebook.cells[1]?.source).toEqual(["print(2)"]);
    expect(notebook.cells[1]?.outputs).toEqual([]);
    expect(notebook.cells[1]?.execution_count).toBeNull();
  });

  it("inserts at the beginning without cell_id", () => {
    const nb = parseNotebookDocument(JSON.stringify(SAMPLE_NOTEBOOK));
    const { notebook } = applyNotebookEdit(nb, {
      editMode: "insert",
      cellType: "markdown",
      newSource: "intro",
    });
    expect(notebook.cells).toHaveLength(3);
    expect(notebook.cells[0]?.cell_type).toBe("markdown");
    expect(notebook.cells[0]?.source).toEqual(["intro"]);
  });

  it("deletes a cell by id", () => {
    const nb = parseNotebookDocument(JSON.stringify(SAMPLE_NOTEBOOK));
    const { notebook } = applyNotebookEdit(nb, {
      editMode: "delete",
      cellId: "md-1",
      newSource: "",
    });
    expect(notebook.cells).toHaveLength(1);
    expect(cellId(notebook.cells[0]!, 0)).toBe("code-1");
  });
});

describe("findCellIndex", () => {
  it("resolves fallback cell-N ids", () => {
    const cells = [{ cell_type: "code" }, { cell_type: "markdown" }];
    expect(findCellIndex(cells, "cell-1")).toBe(1);
  });
});
