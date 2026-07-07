type PdfParseModule = typeof import("pdf-parse");

let pdfParseModule: PdfParseModule | undefined;
let polyfillsReady = false;

/** Minimal 2D affine matrix for pdfjs-dist Node.js text extraction. */
class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: string | DOMMatrixInit | Float32Array | Float64Array | number[]) {
    if (typeof init === "string") return;
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init.slice(0, 6) as number[];
      return;
    }
    if (init && typeof init === "object" && !ArrayBuffer.isView(init)) {
      if (init.a !== undefined) this.a = init.a;
      if (init.b !== undefined) this.b = init.b;
      if (init.c !== undefined) this.c = init.c;
      if (init.d !== undefined) this.d = init.d;
      if (init.e !== undefined) this.e = init.e;
      if (init.f !== undefined) this.f = init.f;
    }
  }

  multiply(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
    const out = new DOMMatrixPolyfill();
    out.a = this.a * other.a + this.c * other.b;
    out.b = this.b * other.a + this.d * other.b;
    out.c = this.a * other.c + this.c * other.d;
    out.d = this.b * other.c + this.d * other.d;
    out.e = this.a * other.e + this.c * other.f + this.e;
    out.f = this.b * other.e + this.d * other.f + this.f;
    return out;
  }

  multiplySelf(other: DOMMatrixPolyfill): this {
    const next = this.multiply(other);
    this.a = next.a;
    this.b = next.b;
    this.c = next.c;
    this.d = next.d;
    this.e = next.e;
    this.f = next.f;
    return this;
  }

  preMultiplySelf(other: DOMMatrixPolyfill): this {
    const next = other.multiply(this);
    this.a = next.a;
    this.b = next.b;
    this.c = next.c;
    this.d = next.d;
    this.e = next.e;
    this.f = next.f;
    return this;
  }

  translateSelf(tx = 0, ty = 0): this {
    this.e += this.a * tx + this.c * ty;
    this.f += this.b * tx + this.d * ty;
    return this;
  }

  scaleSelf(scaleX = 1, scaleY = scaleX): this {
    this.a *= scaleX;
    this.b *= scaleX;
    this.c *= scaleY;
    this.d *= scaleY;
    return this;
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) return this;
    const { a, b, c, d, e, f } = this;
    this.a = d / det;
    this.b = -b / det;
    this.c = -c / det;
    this.d = a / det;
    this.e = (c * f - d * e) / det;
    this.f = (b * e - a * f) / det;
    return this;
  }
}

/** DOM polyfills required by pdfjs-dist before its ESM bundle is evaluated. */
export async function ensurePdfDomPolyfills(): Promise<void> {
  if (polyfillsReady || globalThis.DOMMatrix) {
    polyfillsReady = true;
    return;
  }

  try {
    const canvas = await import("@napi-rs/canvas");
    if (canvas.DOMMatrix) {
      globalThis.DOMMatrix = canvas.DOMMatrix;
      if (canvas.ImageData && !globalThis.ImageData) {
        globalThis.ImageData = canvas.ImageData;
      }
      if (canvas.Path2D && !globalThis.Path2D) {
        globalThis.Path2D = canvas.Path2D;
      }
      polyfillsReady = true;
      return;
    }
  } catch {
    // Use pure JS fallback below.
  }

  globalThis.DOMMatrix = DOMMatrixPolyfill as unknown as typeof DOMMatrix;
  polyfillsReady = true;
}

export async function loadPdfParse(): Promise<PdfParseModule> {
  if (!pdfParseModule) {
    await ensurePdfDomPolyfills();
    pdfParseModule = await import("pdf-parse");
  }
  return pdfParseModule;
}
