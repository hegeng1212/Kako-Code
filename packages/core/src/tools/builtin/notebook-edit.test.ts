import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import {
  notebookEditHandler,
  notebookEditToolDefinition,
  parseNotebookEditInput,
} from "./notebook-edit.js";
import { readHandler } from "./read.js";
import { parseNotebookDocument } from "./notebook.js";
import { toolContext, withTempDir } from "./test-helpers.js";

const SAMPLE_NOTEBOOK = {
  cells: [
    { cell_type: "markdown", id: "md-1", source: "# Title\n" },
    { cell_type: "code", id: "code-1", source: "print(1)\n", outputs: [], execution_count: null },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
};

function readContext(cwd: string, filePath: string) {
  return toolContext(cwd, {
    hasReadFile: (path) => path === filePath,
  });
}

describe("NotebookEdit tool definition", () => {
  it("matches Claude Code schema and description", () => {
    expect(notebookEditToolDefinition.inputSchema.required).toEqual(["notebook_path", "new_source"]);
    expect(notebookEditToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(notebookEditToolDefinition.inputSchema.properties?.edit_mode?.enum).toEqual([
      "replace",
      "insert",
      "delete",
    ]);
    expect(notebookEditToolDefinition.description).toContain("<cell id=");
    expect(notebookEditToolDefinition.description).toContain("required when inserting");
    expect(notebookEditToolDefinition.requiresConfirmation).toBe(true);
  });
});

describe("parseNotebookEditInput", () => {
  it("defaults edit_mode to replace", () => {
    expect(
      parseNotebookEditInput({
        notebook_path: "/tmp/a.ipynb",
        new_source: "x",
        cell_id: "md-1",
      }),
    ).toMatchObject({ editMode: "replace", cellId: "md-1" });
  });

  it("requires absolute notebook_path", () => {
    expect(() =>
      parseNotebookEditInput({ notebook_path: "rel.ipynb", new_source: "x", cell_id: "a" }),
    ).toThrow(/absolute path/);
  });

  it("requires cell_id for delete", () => {
    expect(() =>
      parseNotebookEditInput({
        notebook_path: "/tmp/a.ipynb",
        new_source: "",
        edit_mode: "delete",
      }),
    ).toThrow(/requires cell_id/);
  });

  it("requires cell_type for insert", () => {
    expect(() =>
      parseNotebookEditInput({
        notebook_path: "/tmp/a.ipynb",
        new_source: "x",
        edit_mode: "insert",
      }),
    ).toThrow(/requires cell_type/);
  });
});

describe("notebookEditHandler", () => {
  it("rejects without prior Read", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "nb.ipynb");
      await writeFile(file, JSON.stringify(SAMPLE_NOTEBOOK), "utf-8");
      await expect(
        notebookEditHandler(
          { notebook_path: file, new_source: "x", cell_id: "md-1" },
          toolContext(dir),
        ),
      ).rejects.toThrow(/Read tool/);
    });
  });

  it("replaces a notebook cell after Read", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "nb.ipynb");
      await writeFile(file, JSON.stringify(SAMPLE_NOTEBOOK), "utf-8");
      const ctx = readContext(dir, file);
      const out = await notebookEditHandler(
        { notebook_path: file, new_source: "# Updated", cell_id: "md-1" },
        ctx,
      );
      expect(String(out)).toContain("Replaced cell");
      const saved = parseNotebookDocument(await readFile(file, "utf-8"));
      expect(saved.cells[0]?.source).toEqual(["# Updated"]);
    });
  });
});

describe("NotebookEdit via ToolRegistry", () => {
  it("blocks edit in plan mode", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "nb.ipynb");
      await writeFile(file, JSON.stringify(SAMPLE_NOTEBOOK), "utf-8");
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-1",
        agentId: "agent-main",
        permissionMode: "plan",
      });
      const { registerBuiltinTools } = await import("./registry.js");
      registerBuiltinTools(registry);
      await registry.execute({ id: "r1", name: "Read", input: { file_path: file } });
      const result = await registry.execute({
        id: "n1",
        name: "NotebookEdit",
        input: { notebook_path: file, new_source: "x", cell_id: "md-1" },
      });
      expect(result.status).toBe("denied");
    });
  });
});

describe("read + NotebookEdit integration", () => {
  it("exposes cell ids from Read output", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "nb.ipynb");
      await writeFile(file, JSON.stringify(SAMPLE_NOTEBOOK), "utf-8");
      const output = await readHandler({ file_path: file }, toolContext(dir));
      expect(output).toContain('<cell id="md-1">');
      expect(output).toContain('<cell id="code-1">');
    });
  });
});
