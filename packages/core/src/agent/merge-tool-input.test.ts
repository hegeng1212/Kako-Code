import { describe, expect, it } from "vitest";
import { mergeToolCallInput } from "./merge-tool-input.js";

describe("mergeToolCallInput", () => {
  it("merges partial streamed keys without dropping earlier fields", () => {
    const merged = mergeToolCallInput(
      { file_path: "/tmp/a.html" },
      { content: "<html></html>" },
    );
    expect(merged).toEqual({
      file_path: "/tmp/a.html",
      content: "<html></html>",
    });
  });

  it("lets later values override same keys", () => {
    const merged = mergeToolCallInput(
      { content: "old" },
      { content: "new" },
    );
    expect(merged.content).toBe("new");
  });
});
