import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatPeekSpreadsheetBashCommand, peekSpreadsheet } from "./peek-spreadsheet.js";

describe("peekSpreadsheet", () => {
  it("formats kako CLI bash command with shell-safe quoting", () => {
    expect(formatPeekSpreadsheetBashCommand("/tmp/a b.xlsx", 5)).toBe(
      'kako peek-spreadsheet "/tmp/a b.xlsx" 5',
    );
  });

  it("reads first rows from csv via bundled xlsx", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kako-peek-"));
    const file = join(dir, "sample.csv");
    await writeFile(file, "a,b\n1,2\n3,4\n", "utf-8");
    const text = await peekSpreadsheet(file, 2);
    expect(text).toContain("Spreadsheet from");
    expect(text).toContain("a,b");
    expect(text).toContain("1,2");
  });
});
