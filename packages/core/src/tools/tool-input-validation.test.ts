import { describe, expect, it } from "vitest";
import { validateToolCallInput } from "./tool-input-validation.js";

describe("validateToolCallInput", () => {
  it("rejects Write without file_path", () => {
    expect(
      validateToolCallInput({
        id: "1",
        name: "Write",
        input: { content: "hello" },
      }),
    ).toContain("incomplete");
  });

  it("rejects empty Write input", () => {
    expect(
      validateToolCallInput({
        id: "1",
        name: "Write",
        input: {},
      }),
    ).toContain("incomplete");
  });

  it("accepts Write with absolute file_path", () => {
    expect(
      validateToolCallInput({
        id: "1",
        name: "Write",
        input: { file_path: "/tmp/a.txt", content: "" },
      }),
    ).toBeNull();
  });

  it("rejects Bash without command", () => {
    expect(
      validateToolCallInput({
        id: "1",
        name: "Bash",
        input: {},
      }),
    ).toBe("Bash requires command");
  });
});
