import { describe, expect, it } from "vitest";
import {
  isExecutionBashCommand,
  shellCommandStat,
  toolCallFailurePhrase,
  toolCallStatPhrase,
  toolCallSuccessPhrase,
  toolCallTimelinePhrase,
  toolCallWaitingPhrase,
  mergeActivityStatPhrases,
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

  it("uses neutral timeline phrases", () => {
    expect(toolCallTimelinePhrase("Skill", "baby-growth-record")).toBe("use skill");
    expect(
      toolCallTimelinePhrase("mcp/babytree/bbt_tool.save_growth_records", "{}"),
    ).toBe("called bbt_tool.save_growth_records");
    expect(toolCallTimelinePhrase("Read", "/path/a.md")).toBe("read 1 file");
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

  it("classifies execution vs read-only bash", () => {
    expect(isExecutionBashCommand("ls -la")).toBe(false);
    expect(isExecutionBashCommand("python3 add.py 15.6 28.3")).toBe(true);
  });

  it("maps execution bash to shell command stat", () => {
    expect(toolCallStatPhrase("Bash", "python3 add.py 15.6 28.3", "43.9")).toBe(
      "ran 1 shell command",
    );
    expect(toolCallStatPhrase("Bash", "ls -la /tmp", "drwxr-xr-x  3 user  staff  96 .\n")).toBe(
      "listed 1 directory",
    );
  });

  it("merges duplicate read stats into one phrase", () => {
    expect(mergeActivityStatPhrases(["read 1 file", "read 1 file", "listed 1 directory"])).toEqual([
      "read 2 files",
      "listed 1 directory",
    ]);
  });

  it("formats aggregated shell command stat", () => {
    expect(shellCommandStat(1)).toBe("ran 1 shell command");
    expect(shellCommandStat(2)).toBe("ran 2 shell commands");
  });
});
