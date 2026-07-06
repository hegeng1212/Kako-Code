import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatCatNLine,
  formatTextLines,
  MAX_READ_LINES,
  parseReadInput,
  readHandler,
  readToolDefinition,
  READ_DESCRIPTION,
  resolveReadLimit,
  resolveReadOffset,
} from "./read.js";
import { CLAUDE_READ_DESCRIPTION } from "../claude-tool-text.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { toolContext, withTempDir } from "./test-helpers.js";

describe("Read tool definition", () => {
  it("matches Claude Code schema and description", () => {
    const props = readToolDefinition.inputSchema.properties!;
    expect(readToolDefinition.inputSchema.required).toEqual(["file_path"]);
    expect(readToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(props).sort()).toEqual(["file_path", "limit", "offset", "pages"].sort());
    expect(props.file_path).toEqual({
      type: "string",
      description: "The absolute path to the file to read",
    });
    expect(props.offset).toMatchObject({
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      description:
        "The line number to start reading from. Only provide if the file is too large to read at once",
    });
    expect(props.limit).toMatchObject({
      type: "integer",
      exclusiveMinimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      description:
        "The number of lines to read. Only provide if the file is too large to read at once.",
    });
    expect(props.pages).toEqual({
      type: "string",
      description:
        'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request.',
    });
    expect(READ_DESCRIPTION).toBe(adaptClaudeCodeToolText(CLAUDE_READ_DESCRIPTION));
    expect(readToolDefinition.description).toContain("cat -n format");
    expect(readToolDefinition.description).toContain("Jupyter notebooks");
    expect(readToolDefinition.description).toContain("Do NOT re-read");
    expect(readToolDefinition.requiresConfirmation).toBeUndefined();
  });
});

describe("parseReadInput", () => {
  it("requires absolute file_path", () => {
    expect(() => parseReadInput({ file_path: "relative.txt" })).toThrow(/absolute path/);
  });

  it("accepts legacy path alias", () => {
    const parsed = parseReadInput({ path: "/tmp/a.txt" });
    expect(parsed.filePath).toBe("/tmp/a.txt");
  });
});

describe("resolveReadOffset", () => {
  it("treats 0 as line 1", () => {
    expect(resolveReadOffset(0)).toBe(1);
  });
});

describe("formatCatNLine", () => {
  it("uses tab separator like cat -n", () => {
    expect(formatCatNLine(1, "hello")).toBe("     1\thello");
  });
});

describe("readHandler", () => {
  it("reads file with cat -n line numbers", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "hello.txt");
      await writeFile(file, "line1\nline2\nline3", "utf-8");

      const output = await readHandler({ file_path: file }, toolContext(dir));
      expect(output).toContain("     1\tline1");
      expect(output).toContain("     2\tline2");
    });
  });

  it("respects offset and limit", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "slice.txt");
      await writeFile(file, "a\nb\nc\nd", "utf-8");

      const output = await readHandler({ file_path: file, offset: 2, limit: 2 }, toolContext(dir));
      expect(output).toContain("\tb");
      expect(output).toContain("\tc");
      expect(output).not.toContain("\ta");
      expect(output).not.toContain("\td");
    });
  });

  it("reads Jupyter notebooks as cells", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "nb.ipynb");
      await writeFile(
        file,
        JSON.stringify({
          cells: [
            { cell_type: "markdown", source: "# Title" },
            { cell_type: "code", source: "print(1)", outputs: [{ text: "1" }] },
          ],
        }),
        "utf-8",
      );
      const output = await readHandler({ file_path: file }, toolContext(dir));
      expect(output).toContain('<cell id="cell-0">');
      expect(output).toContain("[markdown] # Title");
      expect(output).toContain('<cell id="cell-1">');
      expect(output).toContain("[code] print(1)");
      expect(output).toContain("[code output]");
    });
  });
});

describe("formatTextLines", () => {
  it("appends truncation hint", () => {
    const out = formatTextLines(["a", "b", "c", "d"], 1, 2);
    expect(out).toContain("... (2 more lines)");
  });
});

describe("readHandler adversarial", () => {
  it("throws when file does not exist", async () => {
    await withTempDir(async (dir) => {
      await expect(
        readHandler({ file_path: join(dir, "missing.txt") }, toolContext(dir)),
      ).rejects.toThrow(/not found/);
    });
  });

  it("rejects relative file_path", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "rel.txt"), "x", "utf-8");
      await expect(readHandler({ file_path: "rel.txt" }, toolContext(dir))).rejects.toThrow(
        /absolute path/,
      );
    });
  });

  it("rejects directories", async () => {
    await withTempDir(async (dir) => {
      const sub = join(dir, "subdir");
      await mkdir(sub);
      await expect(readHandler({ file_path: sub }, toolContext(dir))).rejects.toThrow(
        /directory/,
      );
    });
  });

  it("rejects empty files", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "empty.txt");
      await writeFile(file, "", "utf-8");
      await expect(readHandler({ file_path: file }, toolContext(dir))).rejects.toThrow(/empty/);
    });
  });

  it("reads images as multimodal blocks", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "pic.png");
      // Minimal PNG header bytes
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]);
      await writeFile(file, png);

      const output = await readHandler({ file_path: file }, toolContext(dir));
      expect(Array.isArray(output)).toBe(true);
      const blocks = output as Array<{ type: string }>;
      expect(blocks.some((b) => b.type === "image")).toBe(true);
    });
  });

  it("reads small png files as image blocks", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "pic.png");
      await writeFile(file, "fake-png-bytes", "utf-8");
      const output = await readHandler({ file_path: file }, toolContext(dir));
      expect(Array.isArray(output)).toBe(true);
    });
  });

  it("rejects PDFs until renderer exists", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "doc.pdf");
      await writeFile(file, "%PDF", "utf-8");
      await expect(
        readHandler({ file_path: file, pages: "1" }, toolContext(dir)),
      ).rejects.toThrow(/PDF/);
    });
  });

  it("truncates when file exceeds requested limit", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "big.txt");
      const lines = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");
      await writeFile(file, lines, "utf-8");

      const output = await readHandler({ file_path: file, limit: 10 }, toolContext(dir));
      expect(output).toContain("more lines");
      expect(output).not.toContain("line49");
    });
  });
});

describe("resolveReadLimit", () => {
  it("caps at MAX_READ_LINES", () => {
    expect(resolveReadLimit(99999)).toBe(MAX_READ_LINES);
  });
});
