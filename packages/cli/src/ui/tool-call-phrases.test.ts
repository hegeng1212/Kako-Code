import { describe, expect, it } from "vitest";
import {
  toolCallFailurePhrase,
  toolCallSuccessPhrase,
  toolCallWaitingPhrase,
} from "./tool-call-phrases.js";

describe("tool-call-phrases", () => {
  it("uses tool-specific success phrases", () => {
    expect(toolCallSuccessPhrase("Read", "/path/a.md")).toBe("Read /path/a.md");
    expect(toolCallSuccessPhrase("Write", "out.txt")).toBe("Wrote out.txt");
    expect(toolCallSuccessPhrase("Edit", "src/main.ts")).toBe("Edited src/main.ts");
    expect(toolCallSuccessPhrase("Bash", "ls -la")).toBe("Ran ls -la");
    expect(toolCallSuccessPhrase("Skill", "brainstorming")).toBe(
      "Activated skill brainstorming",
    );
  });

  it("uses tool-specific waiting phrases", () => {
    expect(toolCallWaitingPhrase("Read", "/path/a.md")).toBe("Reading /path/a.md");
    expect(toolCallWaitingPhrase("Skill", "brainstorming")).toBe(
      "Activating skill brainstorming",
    );
    expect(toolCallWaitingPhrase("Bash", "find .")).toBe("Running find .");
  });

  it("formats MCP tools", () => {
    expect(
      toolCallSuccessPhrase("mcp/babytree/bbt_pregnancy.find_baby", "{}"),
    ).toBe("Called bbt_pregnancy.find_baby");
    expect(
      toolCallWaitingPhrase("mcp/babytree/bbt_pregnancy.find_baby", "{}"),
    ).toBe("Calling bbt_pregnancy.find_baby");
  });

  it("parses Agent description from JSON detail", () => {
    const detail = JSON.stringify({
      description: "Load brainstorming skill",
      prompt: "…",
    });
    expect(toolCallSuccessPhrase("Agent", detail)).toBe(
      "Delegated — Load brainstorming skill",
    );
    expect(toolCallWaitingPhrase("Agent", detail)).toBe(
      "Delegating — Load brainstorming skill",
    );
  });

  it("formats failure phrases from waiting phrases", () => {
    expect(toolCallFailurePhrase("Read", "/missing")).toBe("Failed to read /missing");
    expect(toolCallFailurePhrase("Skill", "brainstorming")).toBe(
      "Failed to activate skill brainstorming",
    );
  });

  it("appends error detail when tool target is unknown", () => {
    expect(
      toolCallFailurePhrase("Write", "{}", "Write requires file_path"),
    ).toBe("Failed to write file — Write requires file_path");
  });
});
