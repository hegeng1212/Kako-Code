import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { parseWriteInput, writeHandler, writeToolDefinition, formatWriteResult, FILE_STATE_CURRENT_HINT } from "./write.js";
import { toolContext, withTempDir } from "./test-helpers.js";

describe("Write tool definition", () => {
  it("matches Claude Code schema", () => {
    expect(writeToolDefinition.inputSchema.required).toEqual(["file_path", "content"]);
    expect(writeToolDefinition.inputSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(writeToolDefinition.requiresConfirmation).toBe(true);
    expect(writeToolDefinition.description).toContain(
      "Overwriting an existing file you haven't Read will fail",
    );
    expect(writeToolDefinition.description).toContain("For partial changes, use Edit instead");
  });
});

describe("parseWriteInput", () => {
  it("accepts legacy path/contents aliases", () => {
    expect(parseWriteInput({ path: "/tmp/a.txt", contents: "x" })).toEqual({
      filePath: "/tmp/a.txt",
      content: "x",
    });
  });

  it("requires absolute file_path", () => {
    expect(() => parseWriteInput({ file_path: "rel.txt", content: "x" })).toThrow(/absolute/);
  });
});

describe("formatWriteResult", () => {
  it("announces create vs update and hints no Read needed", () => {
    expect(formatWriteResult("/tmp/a.py", true)).toBe(
      `File created successfully at: /tmp/a.py ${FILE_STATE_CURRENT_HINT}`,
    );
    expect(formatWriteResult("/tmp/a.py", false)).toBe(
      `File updated successfully at: /tmp/a.py ${FILE_STATE_CURRENT_HINT}`,
    );
  });
});

describe("writeHandler", () => {
  it("creates nested directories and writes file", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "nested", "out.txt");
      const msg = await writeHandler({ file_path: path, content: "hello\nworld" }, toolContext(dir));
      expect(msg).toBe(formatWriteResult(path, true));
      expect(await readFile(path, "utf-8")).toBe("hello\nworld");
    });
  });

  it("overwrites existing file after read", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "a.txt");
      await writeFile(path, "v1", "utf-8");
      const ctx = toolContext(dir, {
        hasReadFile: (p) => p === path,
      });
      await writeHandler({ file_path: path, content: "v2" }, ctx);
      expect(await readFile(path, "utf-8")).toBe("v2");
    });
  });

  it("rejects overwrite without prior read", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "a.txt");
      await writeFile(path, "v1", "utf-8");
      const ctx = toolContext(dir, { hasReadFile: () => false });
      await expect(
        writeHandler({ file_path: path, content: "v2" }, ctx),
      ).rejects.toThrow(/Read tool/);
    });
  });

  it("writes empty content to new file", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "empty.txt");
      await writeHandler({ file_path: path, content: "" }, toolContext(dir));
      expect(await readFile(path, "utf-8")).toBe("");
    });
  });
});

describe("writeHandler adversarial", () => {
  it("throws on path containing null byte", async () => {
    await withTempDir(async (dir) => {
      const bad = join(dir, "a\u0000b");
      await expect(
        writeHandler({ file_path: bad, content: "x" }, toolContext(dir)),
      ).rejects.toThrow();
    });
  });

  it("allows Edit immediately after Write without separate Read", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "add.py");
      const registry = new ToolRegistry({
        cwd: dir,
        sessionId: "sess-write-edit",
        agentId: "agent-1",
      });
      const { registerBuiltinTools } = await import("./registry.js");
      registerBuiltinTools(registry);

      const write = await registry.execute({
        id: "tu-w",
        name: "Write",
        input: {
          file_path: path,
          content: "print(1)\n",
        },
      });
      expect(write.status).toBe("success");
      expect(String(write.output)).toContain(FILE_STATE_CURRENT_HINT);

      const edit = await registry.execute({
        id: "tu-e",
        name: "Edit",
        input: {
          file_path: path,
          old_string: "print(1)",
          new_string: "print(2)",
        },
      });
      expect(edit.status).toBe("success");
      expect(await readFile(path, "utf-8")).toBe("print(2)\n");
    });
  });
});
