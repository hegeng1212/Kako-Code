import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_NOTEBOOK_EDIT_DESCRIPTION } from "../claude-tool-text.js";
import {
  applyNotebookEdit,
  parseNotebookDocument,
  serializeNotebook,
  type NotebookCellType,
  type NotebookEditMode,
} from "./notebook.js";
import { resolvePath } from "./path.js";

export const NOTEBOOK_EDIT_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_NOTEBOOK_EDIT_DESCRIPTION);

export const notebookEditToolDefinition: ToolDefinition = {
  name: "NotebookEdit",
  description: NOTEBOOK_EDIT_DESCRIPTION,
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      notebook_path: {
        type: "string",
        description: "The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)",
      },
      new_source: {
        type: "string",
        description: "The new source for the cell",
      },
      cell_id: {
        type: "string",
        description:
          "The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified.",
      },
      cell_type: {
        type: "string",
        enum: ["code", "markdown"],
        description:
          "The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required.",
      },
      edit_mode: {
        type: "string",
        enum: ["replace", "insert", "delete"],
        description: "The type of edit to make (replace, insert, delete). Defaults to replace.",
      },
    },
    required: ["notebook_path", "new_source"],
  },
};

export interface ParsedNotebookEditInput {
  notebookPath: string;
  newSource: string;
  cellId?: string;
  cellType?: NotebookCellType;
  editMode: NotebookEditMode;
}

function parseEditMode(raw: unknown): NotebookEditMode {
  const mode = typeof raw === "string" ? raw.trim() : "";
  if (!mode || mode === "replace") return "replace";
  if (mode === "insert" || mode === "delete") return mode;
  throw new Error('NotebookEdit edit_mode must be "replace", "insert", or "delete"');
}

function parseCellType(raw: unknown): NotebookCellType | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (raw === "code" || raw === "markdown") return raw;
  throw new Error('NotebookEdit cell_type must be "code" or "markdown"');
}

export function parseNotebookEditInput(raw: Record<string, unknown>): ParsedNotebookEditInput {
  const notebookPath = String(raw.notebook_path ?? "").trim();
  if (!notebookPath) {
    throw new Error("NotebookEdit requires notebook_path");
  }
  if (!isAbsolute(notebookPath)) {
    throw new Error("NotebookEdit requires notebook_path to be an absolute path");
  }

  const editMode = parseEditMode(raw.edit_mode);
  const cellId =
    typeof raw.cell_id === "string" && raw.cell_id.trim() ? raw.cell_id.trim() : undefined;
  const cellType = parseCellType(raw.cell_type);

  if ((editMode === "replace" || editMode === "delete") && !cellId) {
    throw new Error(`NotebookEdit ${editMode} requires cell_id`);
  }
  if (editMode === "insert" && !cellType) {
    throw new Error("NotebookEdit insert requires cell_type");
  }

  return {
    notebookPath,
    newSource: String(raw.new_source ?? ""),
    cellId,
    cellType,
    editMode,
  };
}

export const notebookEditHandler: ToolHandler = async (input, context) => {
  const parsed = parseNotebookEditInput(input);
  const notebookPath = resolvePath(parsed.notebookPath, context.cwd);

  if (!notebookPath.endsWith(".ipynb")) {
    throw new Error("NotebookEdit only supports .ipynb files");
  }

  if (!context.hasReadFile || !context.hasReadFile(notebookPath)) {
    throw new Error(
      "You must use the Read tool on the notebook in this conversation before editing — this tool will fail otherwise.",
    );
  }

  const content = await readFile(notebookPath, "utf-8");
  const notebook = parseNotebookDocument(content);
  const { notebook: updated, summary } = applyNotebookEdit(notebook, {
    editMode: parsed.editMode,
    cellId: parsed.cellId,
    cellType: parsed.cellType,
    newSource: parsed.newSource,
  });
  await writeFile(notebookPath, serializeNotebook(updated), "utf-8");
  return `${summary}: ${notebookPath}`;
};
