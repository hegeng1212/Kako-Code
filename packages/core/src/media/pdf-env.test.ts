import { describe, expect, it } from "vitest";
import { ensurePdfDomPolyfills, loadPdfParse } from "./pdf-env.js";

describe("pdf-env", () => {
  it("installs DOMMatrix before loading pdf-parse", async () => {
    await ensurePdfDomPolyfills();
    expect(globalThis.DOMMatrix).toBeDefined();
    const mod = await loadPdfParse();
    expect(mod.PDFParse).toBeTypeOf("function");
  });
});
