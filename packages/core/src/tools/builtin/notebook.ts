import { randomUUID } from "node:crypto";
import { formatTextLines } from "./text-format.js";

export type NotebookCellType = "code" | "markdown";
export type NotebookEditMode = "replace" | "insert" | "delete";

export interface NotebookCell {
  cell_type?: string;
  id?: string;
  metadata?: Record<string, unknown>;
  source?: string | string[];
  outputs?: unknown[];
  execution_count?: number | null;
}

export interface NotebookDocument {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

export function parseNotebookDocument(content: string): NotebookDocument {
  const parsed = JSON.parse(content) as NotebookDocument;
  if (!Array.isArray(parsed.cells)) {
    throw new Error("Invalid notebook: missing cells array");
  }
  return parsed;
}

export function cellId(cell: NotebookCell, index: number): string {
  return typeof cell.id === "string" && cell.id.trim() ? cell.id : `cell-${index}`;
}

export function normalizeCellSource(source: string | string[] | undefined): string {
  if (Array.isArray(source)) return source.join("");
  return String(source ?? "");
}

export function toNbformatSource(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? `${line}\n` : line));
}

export function findCellIndex(cells: NotebookCell[], cellIdValue: string): number {
  for (let i = 0; i < cells.length; i++) {
    if (cellId(cells[i]!, i) === cellIdValue || cells[i]?.id === cellIdValue) {
      return i;
    }
  }
  const fallback = /^cell-(\d+)$/.exec(cellIdValue);
  if (fallback) {
    const index = Number(fallback[1]);
    if (Number.isInteger(index) && index >= 0 && index < cells.length) {
      return index;
    }
  }
  throw new Error(`Notebook cell not found: ${cellIdValue}`);
}

export function formatNotebookForRead(content: string, offset: number, limit: number): string {
  const nb = parseNotebookDocument(content);
  const rendered: string[] = [];
  for (let i = 0; i < nb.cells.length; i++) {
    const cell = nb.cells[i]!;
    const id = cellId(cell, i);
    const type = cell.cell_type ?? "unknown";
    const source = normalizeCellSource(cell.source);
    rendered.push(`<cell id="${id}">`);
    for (const line of source.split("\n")) {
      rendered.push(`[${type}] ${line}`);
    }
    if (cell.outputs?.length) {
      rendered.push(`[${type} output] ${JSON.stringify(cell.outputs).slice(0, 500)}`);
    }
    rendered.push("</cell>");
    rendered.push("");
  }
  while (rendered.length > 0 && rendered[rendered.length - 1] === "") {
    rendered.pop();
  }
  return formatTextLines(rendered, offset, limit);
}

function createNotebookCell(type: NotebookCellType, source: string): NotebookCell {
  const cell: NotebookCell = {
    cell_type: type,
    id: randomUUID(),
    metadata: {},
    source: toNbformatSource(source),
  };
  if (type === "code") {
    cell.outputs = [];
    cell.execution_count = null;
  }
  return cell;
}

export interface NotebookEditRequest {
  editMode: NotebookEditMode;
  cellId?: string;
  cellType?: NotebookCellType;
  newSource: string;
}

export function applyNotebookEdit(
  notebook: NotebookDocument,
  request: NotebookEditRequest,
): { notebook: NotebookDocument; summary: string } {
  const cells = [...notebook.cells];

  if (request.editMode === "replace") {
    if (!request.cellId) {
      throw new Error("NotebookEdit replace requires cell_id");
    }
    const index = findCellIndex(cells, request.cellId);
    const cell = { ...cells[index]! };
    cell.source = toNbformatSource(request.newSource);
    if (request.cellType) {
      cell.cell_type = request.cellType;
    }
    if ((cell.cell_type ?? "code") === "code") {
      cell.outputs = [];
      cell.execution_count = null;
    }
    if (!cell.id) {
      cell.id = randomUUID();
    }
    cells[index] = cell;
    return {
      notebook: { ...notebook, cells },
      summary: `Replaced cell ${cellId(cell, index)} in notebook`,
    };
  }

  if (request.editMode === "delete") {
    if (!request.cellId) {
      throw new Error("NotebookEdit delete requires cell_id");
    }
    const index = findCellIndex(cells, request.cellId);
    const removed = cellId(cells[index]!, index);
    cells.splice(index, 1);
    return {
      notebook: { ...notebook, cells },
      summary: `Deleted cell ${removed} from notebook`,
    };
  }

  const insertType = request.cellType;
  if (!insertType) {
    throw new Error("NotebookEdit insert requires cell_type");
  }
  const newCell = createNotebookCell(insertType, request.newSource);
  let insertAt = 0;
  if (request.cellId) {
    const index = findCellIndex(cells, request.cellId);
    insertAt = index + 1;
  }
  cells.splice(insertAt, 0, newCell);
  return {
    notebook: { ...notebook, cells },
    summary: `Inserted ${insertType} cell after ${request.cellId ?? "start of notebook"}`,
  };
}

export function serializeNotebook(notebook: NotebookDocument): string {
  return `${JSON.stringify(notebook, null, 2)}\n`;
}
