import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boundToolResultForModel } from "./oversized-result.js";

let tempHome: string | undefined;
let prevHome: string | undefined;

afterEach(async () => {
  if (prevHome !== undefined) {
    process.env.KAKO_HOME = prevHome;
  } else {
    delete process.env.KAKO_HOME;
  }
  if (tempHome) {
    const { rm } = await import("node:fs/promises");
    await rm(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});

async function withTempKakoHome(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  tempHome = await mkdtemp(join(tmpdir(), "kako-oversized-"));
  prevHome = process.env.KAKO_HOME;
  process.env.KAKO_HOME = tempHome;
  return tempHome;
}

describe("boundToolResultForModel", () => {
  it("returns small content unchanged", async () => {
    await withTempKakoHome();
    const content = "hello world";
    const out = await boundToolResultForModel({
      sessionId: "sess-1",
      toolCallId: "tu-abc",
      content,
    });
    expect(out).toBe(content);
  });

  it("persists oversized content and returns a preview stub", async () => {
    await withTempKakoHome();
    const content = "x".repeat(9000);
    const out = await boundToolResultForModel({
      sessionId: "sess-1",
      toolCallId: "tu-abc",
      content,
      persistAboveChars: 8000,
      previewChars: 2048,
    });

    expect(out).toContain("Output too large (9KB)");
    expect(out).toContain("Preview (first 2KB):");
    expect(out).toContain("x".repeat(2048));
    expect(out).toContain("Use Read to load the rest from:");

    const savedPath = out.match(/Full output saved to: (.+)/)?.[1];
    expect(savedPath).toBeTruthy();
    expect(await readFile(savedPath!, "utf-8")).toBe(content);
  });

  it("respects custom thresholds", async () => {
    await withTempKakoHome();
    const content = "y".repeat(200);
    const out = await boundToolResultForModel({
      sessionId: "sess-2",
      toolCallId: "tu/custom",
      content,
      persistAboveChars: 100,
      previewChars: 50,
    });

    expect(out).toContain("Preview (first 1KB):");
    expect(out).toContain("y".repeat(50));
    expect(out).not.toContain("y".repeat(200));
  });
});
