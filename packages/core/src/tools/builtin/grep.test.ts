import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileGrepRegex,
  formatGrepOutput,
  grepFileContent,
  grepHandler,
  parseGrepInput,
} from "./grep.js";
import { globHandler, parseGlobInput } from "./glob.js";
import { globPatternToRegExp, pathMatchesGlob } from "./workspace-walk.js";
import { toolContext, withTempDir } from "./test-helpers.js";

describe("workspace-walk glob", () => {
  it("matches recursive and basename patterns", () => {
    expect(pathMatchesGlob("src/foo.ts", "**/*.ts")).toBe(true);
    expect(pathMatchesGlob("foo.ts", "*.ts")).toBe(true);
    expect(pathMatchesGlob("src/foo.go", "*.ts")).toBe(false);
    expect(globPatternToRegExp("**/*.ts").test("pkg/a.ts")).toBe(true);
  });
});

describe("grep parsing", () => {
  it("defaults path to cwd", () => {
    const parsed = parseGrepInput({ pattern: "foo" }, "/tmp/project");
    expect(parsed.path).toBe("/tmp/project");
    expect(parsed.headLimit).toBe(100);
  });

  it("rejects empty pattern", () => {
    expect(() => parseGrepInput({}, "/tmp")).toThrow(/pattern/);
  });
});

describe("grepFileContent", () => {
  it("finds line matches with head limit", () => {
    const regex = compileGrepRegex("alpha", { caseInsensitive: false, multiline: false });
    const { matches } = grepFileContent(
      "/tmp/a.ts",
      "beta\nalpha one\nalpha two",
      regex,
      1,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.lineNumber).toBe(2);
  });
});

describe("formatGrepOutput", () => {
  it("formats content and files_with_matches modes", () => {
    const matches = [
      { filePath: "/proj/src/a.ts", lineNumber: 10, line: "const x = 1;" },
      { filePath: "/proj/src/b.ts", lineNumber: 3, line: "const y = 2;" },
    ];
    expect(formatGrepOutput(matches, "content", "/proj")).toContain("src/a.ts:10:");
    expect(formatGrepOutput(matches, "files_with_matches", "/proj")).toBe("src/a.ts\nsrc/b.ts");
  });
});

describe("grepHandler", () => {
  it("searches directory and returns matches", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "a.ts"), "export const TOKEN = 1;\n", "utf-8");
      await writeFile(join(dir, "src", "b.go"), "package main\n", "utf-8");

      const out = await grepHandler(
        { pattern: "TOKEN", glob: "**/*.ts" },
        toolContext(dir),
      );
      expect(out).toContain("src/a.ts");
      expect(out).toContain("TOKEN");
      expect(out).not.toContain("b.go");
    });
  });
});

describe("globHandler", () => {
  it("lists files by pattern", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, "pkg"), { recursive: true });
      await writeFile(join(dir, "pkg", "one.ts"), "", "utf-8");
      await writeFile(join(dir, "pkg", "two.go"), "", "utf-8");

      const out = await globHandler({ pattern: "**/*.ts" }, toolContext(dir));
      expect(out).toContain("pkg/one.ts");
      expect(out).not.toContain("two.go");
    });
  });

  it("parses pattern requirement", () => {
    expect(() => parseGlobInput({}, "/tmp")).toThrow(/pattern/);
  });
});
