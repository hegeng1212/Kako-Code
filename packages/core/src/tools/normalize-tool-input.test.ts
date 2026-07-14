import { describe, expect, it } from "vitest";
import {
  decodeToolInputEntities,
  normalizeToolCall,
  normalizeToolCallInput,
} from "./normalize-tool-input.js";

describe("decodeToolInputEntities", () => {
  it("decodes ampersands in source code", () => {
    expect(decodeToolInputEntities("var x = &amp;foo{}")).toBe("var x = &foo{}");
  });

  it("decodes common HTML entities", () => {
    expect(decodeToolInputEntities("&lt;tag&gt; &quot;hi&quot; &apos;x&apos; &#39;y&#39;")).toBe(
      `<tag> "hi" 'x' 'y'`,
    );
  });
});

describe("normalizeToolCallInput", () => {
  it("recursively decodes nested string fields", () => {
    expect(
      normalizeToolCallInput({
        file_path: "/tmp/a.go",
        content: "var FileUploadController = &amp;fileUploadController{}",
        nested: { old_string: "a &amp; b" },
        list: ["&lt;div&gt;"],
      }),
    ).toEqual({
      file_path: "/tmp/a.go",
      content: "var FileUploadController = &fileUploadController{}",
      nested: { old_string: "a & b" },
      list: ["<div>"],
    });
  });
});

describe("normalizeToolCall", () => {
  it("normalizes tool call input", () => {
    const normalized = normalizeToolCall({
      id: "tu-1",
      name: "Write",
      input: {
        file_path: "/tmp/a.go",
        content: "&amp;ptr",
      },
    });
    expect(normalized.input.content).toBe("&ptr");
  });
});
