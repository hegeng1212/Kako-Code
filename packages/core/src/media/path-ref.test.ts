import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { findLeadingAbsolutePath, parsePathReferences, unescapePathCandidate } from "./path-ref.js";

async function withTempFile(name: string, run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kako-path-ref-"));
  const file = join(dir, name);
  await writeFile(file, "x", "utf-8");
  try {
    await run(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("unescapePathCandidate", () => {
  it("unescapes shell-style special characters in pasted paths", () => {
    expect(unescapePathCandidate("/tmp/u\\=1\\,2\\&f\\=jpeg.jpeg")).toBe("/tmp/u=1,2&f=jpeg.jpeg");
  });
});

describe("findLeadingAbsolutePath", () => {
  it("splits path from trailing question", async () => {
    await withTempFile("report.xlsx", async (file) => {
      const input = `${file}  这是什么内容`;
      const result = await findLeadingAbsolutePath(input);
      expect(result?.path).toBe(file);
      expect(result?.rest).toBe("这是什么内容");
    });
  });

  it("handles escaped spaces in path", async () => {
    await withTempFile("formula version.xlsx", async (file) => {
      const escaped = file.replace(/ /g, "\\ ");
      const result = await findLeadingAbsolutePath(`${escaped}  summary`);
      expect(result?.path).toBe(file);
      expect(result?.rest).toBe("summary");
    });
  });
});

describe("parsePathReferences", () => {
  it("extracts @/path markers and keeps question text", async () => {
    await withTempFile("data.csv", async (file) => {
      const parsed = await parsePathReferences(`@${file}  explain columns`);
      expect(parsed.paths).toEqual([file]);
      expect(parsed.text).toBe("explain columns");
    });
  });

  it("parses leading bare path before question", async () => {
    await withTempFile("weekly.xlsx", async (file) => {
      const parsed = await parsePathReferences(`${file}  这是什么内容`);
      expect(parsed.paths).toEqual([file]);
      expect(parsed.text).toBe("这是什么内容");
    });
  });

  it("leaves plain text unchanged when no path matches", async () => {
    const parsed = await parsePathReferences("hello world");
    expect(parsed.paths).toEqual([]);
    expect(parsed.text).toBe("hello world");
  });
});
