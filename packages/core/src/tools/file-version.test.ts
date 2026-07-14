import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fileVersionChanged,
  formatFileVersionRefresh,
  snapshotFileVersion,
} from "./file-version.js";
import { withTempDir } from "./builtin/test-helpers.js";

describe("file version tracking", () => {
  it("detects mtime or size changes", () => {
    const before = { mtimeMs: 1000, size: 10 };
    expect(fileVersionChanged(before, { mtimeMs: 1001, size: 10 })).toBe(true);
    expect(fileVersionChanged(before, { mtimeMs: 1000, size: 11 })).toBe(true);
    expect(fileVersionChanged(before, { mtimeMs: 1000, size: 10 })).toBe(false);
  });

  it("snapshots file stat from disk", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "sample.txt");
      await writeFile(path, "hello", "utf-8");
      const snap = await snapshotFileVersion(path);
      expect(snap.size).toBe(5);
      expect(snap.mtimeMs).toBeGreaterThan(0);
    });
  });

  it("formats numbered refresh block like Read output", () => {
    const text = formatFileVersionRefresh("/tmp/a.go", "line one\nline two");
    expect(text).toContain('<file-version-refresh path="/tmp/a.go">');
    expect(text).toContain("     1\tline one");
    expect(text).toContain("     2\tline two");
    expect(text).toContain("</file-version-refresh>");
  });
});
