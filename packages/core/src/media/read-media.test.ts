import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  extractPptxTextFromBuffer,
  isLikelyTextBuffer,
  previewDocumentText,
  readDocumentText,
} from "./read-media.js";

async function withTempFile(name: string, content: string | Buffer, run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kako-read-media-"));
  const file = join(dir, name);
  await writeFile(file, content);
  try {
    await run(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("isLikelyTextBuffer", () => {
  it("accepts utf-8 prose and rejects null-byte payloads", () => {
    expect(isLikelyTextBuffer(Buffer.from("# Skill\n\nHello", "utf-8"))).toBe(true);
    expect(isLikelyTextBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0x1a]))).toBe(false);
  });
});

describe("previewDocumentText", () => {
  it("previews markdown attachments instead of throwing", async () => {
    await withTempFile("SKILL.md", "# Demo skill\n\nUse this skill.", async (file) => {
      const preview = await previewDocumentText(file);
      expect(preview).toContain("Text from");
      expect(preview).toContain("# Demo skill");
    });
  });

  it("previews unknown text-like extensions via utf-8 fallback", async () => {
    await withTempFile("config.json", '{"name":"kako"}', async (file) => {
      const preview = await previewDocumentText(file);
      expect(preview).toContain('"name":"kako"');
    });
  });

  it("returns a binary summary instead of throwing for opaque files", async () => {
    await withTempFile("blob.bin", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0x1a, 0x0b]), async (file) => {
      const preview = await previewDocumentText(file);
      expect(preview).toContain("Binary file:");
      expect(preview).toContain("No text preview available");
    });
  });
});

describe("readDocumentText", () => {
  it("reads plain text with line numbers", async () => {
    await withTempFile("notes.txt", "alpha\nbeta\n", async (file) => {
      const text = await readDocumentText(file, { offset: 2, limit: 1 });
      expect(text).toContain("Text from");
      expect(text).toContain("beta");
    });
  });
});

describe("extractPptxTextFromBuffer", () => {
  it("extracts slide text and speaker notes from pptx zip payload", () => {
    const slide1 = `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Quarterly revenue</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
    const notes1 = `<?xml version="1.0"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Discuss APAC growth</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`;

    const buffer = zipSync({
      "ppt/slides/slide1.xml": new TextEncoder().encode(slide1),
      "ppt/notesSlides/notesSlide1.xml": new TextEncoder().encode(notes1),
    });

    const text = extractPptxTextFromBuffer(buffer);
    expect(text).toContain("## Slide 1");
    expect(text).toContain("Quarterly revenue");
    expect(text).toContain("Notes: Discuss APAC growth");
  });
});
