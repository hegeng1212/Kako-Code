import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWriteInput, writeHandler, writeToolDefinition } from "./write.js";
import { toolContext, withTempDir } from "./test-helpers.js";

describe("Write tool definition", () => {
  it("matches Claude Code schema", () => {
    expect(writeToolDefinition.inputSchema.required).toEqual(["file_path", "content"]);
    expect(writeToolDefinition.requiresConfirmation).toBe(true);
    expect(writeToolDefinition.description).toContain("Read tool first");
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

describe("writeHandler", () => {
  it("creates nested directories and writes file", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "nested", "out.txt");
      const msg = await writeHandler({ file_path: path, content: "hello\nworld" }, toolContext(dir));
      expect(msg).toContain("2 lines");
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

  it("rejects relative file_path", async () => {
    await withTempDir(async (dir) => {
      await expect(
        writeHandler({ file_path: "rel.txt", content: "ok" }, toolContext(dir)),
      ).rejects.toThrow(/absolute/);
    });
  });
});
