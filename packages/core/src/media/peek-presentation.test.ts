import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatPeekPresentationBashCommand,
  peekPresentation,
} from "./peek-presentation.js";

describe("peekPresentation", () => {
  it("formats kako CLI bash command with shell-safe quoting", () => {
    expect(formatPeekPresentationBashCommand("/tmp/a b.pptx", 3)).toBe(
      'kako peek-presentation "/tmp/a b.pptx" 3',
    );
  });

  it("extracts slide text from pptx", async () => {
    const slide1 = `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello deck</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
    const dir = await mkdtemp(join(tmpdir(), "kako-peek-ppt-"));
    const file = join(dir, "deck.pptx");
    const buffer = zipSync({
      "ppt/slides/slide1.xml": new TextEncoder().encode(slide1),
    });
    await writeFile(file, buffer);

    const text = await peekPresentation(file, 1);
    expect(text).toContain("PowerPoint text from");
    expect(text).toContain("Hello deck");
  });
});
