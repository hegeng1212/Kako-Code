import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import {
  applyStringReplace,
  editHandler,
  editToolDefinition,
  formatEditResult,
  parseEditInput,
} from "./edit.js";
import { FILE_VERSION_REFRESH_TAG } from "../file-version.js";
import { readHandler, readToolDefinition } from "./read.js";
import { toolContext, withTempDir } from "./test-helpers.js";

function readContext(cwd: string, filePath: string) {
  return toolContext(cwd, {
    hasReadFile: (path) => path === filePath,
  });
}

describe("Edit tool definition", () => {
  it("matches Claude Code schema and description", () => {
    expect(editToolDefinition.inputSchema.required).toEqual([
      "file_path",
      "old_string",
      "new_string",
    ]);
    expect(editToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(editToolDefinition.inputSchema.properties?.replace_all).toMatchObject({
      type: "boolean",
      default: false,
      description: "Replace all occurrences of old_string (default false)",
    });
    expect(editToolDefinition.description).toBe(
      `Performs exact string replacement in a file.

- You must Read the file in this conversation before editing, or the call will fail.
- \`old_string\` must match the file exactly, including indentation, and be unique — the edit fails otherwise. Strip the Read line prefix (line number + tab) before matching.
- \`replace_all: true\` replaces every occurrence instead.
- When the on-disk file changed since your last Read or successful Write/Edit on this path, the tool result includes the current file contents. When unchanged, only the edit summary is returned. Failed edits also include the current file to help you retry.`,
    );
    expect(editToolDefinition.requiresConfirmation).toBe(true);
  });
});

describe("parseEditInput", () => {
  it("parses replace_all", () => {
    const parsed = parseEditInput({
      file_path: "/a/b.ts",
      old_string: "foo",
      new_string: "bar",
      replace_all: true,
    });
    expect(parsed.replaceAll).toBe(true);
  });
});

describe("applyStringReplace", () => {
  it("replaces a unique occurrence", () => {
    const result = applyStringReplace("hello world", "world", "there", false);
    expect(result.content).toBe("hello there");
    expect(result.replacements).toBe(1);
  });

  it("replaces all occurrences when replace_all is true", () => {
    const result = applyStringReplace("a a a", "a", "b", true);
    expect(result.content).toBe("b b b");
    expect(result.replacements).toBe(3);
  });

  it("rejects non-unique match without replace_all", () => {
    expect(() => applyStringReplace("a a", "a", "b", false)).toThrow(/not unique/);
  });

  it("rejects missing old_string", () => {
    expect(() => applyStringReplace("hello", "missing", "x", false)).toThrow(/not found/);
  });
});

describe("editHandler", () => {
  it("edits a file after Read", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "sample.txt");
      await writeFile(path, "alpha\nbeta\n", "utf-8");
      const ctx = readContext(dir, path);
      const msg = await editHandler(
        { file_path: path, old_string: "beta", new_string: "gamma" },
        ctx,
      );
      expect(msg).toContain("Replaced 1 occurrence");
      expect(await readFile(path, "utf-8")).toBe("alpha\ngamma\n");
    });
  });

  it("requires Read before edit when hasReadFile is provided", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "locked.txt");
      await writeFile(path, "x", "utf-8");
      await expect(
        editHandler(
          { file_path: path, old_string: "x", new_string: "y" },
          toolContext(dir, { hasReadFile: () => false }),
        ),
      ).rejects.toThrow(/Read the file/);
    });
  });

  it("attaches current file content when old_string is not found", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "stale.txt");
      await writeFile(path, "current-line\n", "utf-8");
      await expect(
        editHandler(
          { file_path: path, old_string: "missing", new_string: "new" },
          readContext(dir, path),
        ),
      ).rejects.toThrow(new RegExp(`${FILE_VERSION_REFRESH_TAG}.*current-line`, "s"));
    });
  });

  it("attaches refreshed file content when version is stale", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "versioned.txt");
      await writeFile(path, "alpha\n", "utf-8");
      const ctx = {
        ...readContext(dir, path),
        isFileVersionStale: async () => true,
        noteFileVersion: async () => {},
      };
      const msg = await editHandler(
        { file_path: path, old_string: "alpha", new_string: "beta" },
        ctx,
      );
      expect(msg).toContain("Replaced 1 occurrence");
      expect(msg).toContain(FILE_VERSION_REFRESH_TAG);
      expect(msg).toContain("beta");
    });
  });
});

describe("parseEditInput adversarial", () => {
  it("rejects identical old and new strings", () => {
    expect(() =>
      parseEditInput({ file_path: "a.ts", old_string: "same", new_string: "same" }),
    ).toThrow(/differ/);
  });

  it("rejects empty file_path", () => {
    expect(() =>
      parseEditInput({ file_path: "  ", old_string: "a", new_string: "b" }),
    ).toThrow(/file_path/);
  });
});

describe("formatEditResult", () => {
  it("uses plural for multiple replacements", () => {
    expect(formatEditResult("/tmp/x.ts", 2)).toContain("2 occurrences");
  });
});

describe("Edit via ToolRegistry", () => {
  it("allows edit after Read in the same turn", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "via-registry.txt");
      await writeFile(path, "before", "utf-8");
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-edit",
        agentId: "agent-main",
      });
      registry.register(readToolDefinition, readHandler);
      registry.register(editToolDefinition, editHandler);

      const readResult = await registry.execute({
        id: "tu-read",
        name: "Read",
        input: { file_path: path },
      });
      expect(readResult.status).toBe("success");

      const editResult = await registry.execute({
        id: "tu-edit",
        name: "Edit",
        input: { file_path: path, old_string: "before", new_string: "after" },
      });
      expect(editResult.status).toBe("success");
      expect(await readFile(path, "utf-8")).toBe("after");
    });
  });

  it("blocks edit when file was not Read", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "unread.txt");
      await writeFile(path, "x", "utf-8");
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-edit",
        agentId: "agent-main",
      });
      registry.register(editToolDefinition, editHandler);

      const editResult = await registry.execute({
        id: "tu-edit",
        name: "Edit",
        input: { file_path: path, old_string: "x", new_string: "y" },
      });
      expect(editResult.status).toBe("error");
      expect(editResult.error).toContain("Read the file");
    });
  });

  it("includes current file on failed edit after Read", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "retry.txt");
      await writeFile(path, "keep-me\n", "utf-8");
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-edit",
        agentId: "agent-main",
      });
      registry.register(readToolDefinition, readHandler);
      registry.register(editToolDefinition, editHandler);

      await registry.execute({
        id: "tu-read",
        name: "Read",
        input: { file_path: path },
      });

      const editResult = await registry.execute({
        id: "tu-edit",
        name: "Edit",
        input: { file_path: path, old_string: "missing", new_string: "new" },
      });
      expect(editResult.status).toBe("error");
      expect(editResult.error).toContain(FILE_VERSION_REFRESH_TAG);
      expect(editResult.error).toContain("keep-me");
    });
  });
});
