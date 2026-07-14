import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryGetHandler, memoryGetToolDefinition, resolveMemoryPath } from "./memory-get.js";
import { toolContext } from "./test-helpers.js";

describe("MemoryGet tool definition", () => {
  it("requires path", () => {
    expect(memoryGetToolDefinition.inputSchema.required).toEqual(["path"]);
    expect(memoryGetToolDefinition.description).toContain("memory directory");
  });
});

describe("MemoryGet handler", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-mg-"));
    prevHome = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  });

  it("reads a memory-relative path by line range", async () => {
    const dir = join(home, "memory", "facts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "note.md"), "a\nb\nc\n", "utf-8");
    const out = await memoryGetHandler(
      { path: "facts/note.md", startLine: 1, endLine: 2 },
      toolContext("/tmp"),
    );
    expect(out).toBe("a\nb");
  });

  it("rejects paths outside memory root", () => {
    expect(() => resolveMemoryPath("/etc/passwd")).toThrow(/Access denied/);
  });
});
