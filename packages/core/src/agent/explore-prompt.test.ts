import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const EXPLORE_PROMPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../agents/prompts/explore.md",
);

describe("explore agent prompt", () => {
  it("matches Claude Explore contract adapted for Kako tools", async () => {
    const text = await readFile(EXPLORE_PROMPT, "utf-8");
    expect(text).toContain("file search specialist");
    expect(text).toContain("READ-ONLY MODE");
    expect(text).toContain("STRICTLY PROHIBITED");
    expect(text).toContain("redirect operators");
    expect(text).toContain("Glob");
    expect(text).toContain("Grep");
    expect(text).toContain("Read");
    expect(text).toContain("parallel tool calls");
    expect(text).toContain("as quickly as possible");
    expect(text).toContain("Complete the user's search request");
    expect(text).toContain("Do NOT Write report");
    expect(text).toContain("consent or approval");
    expect(text).toContain("always absolute");
    expect(text).toContain("MUST avoid using emojis");
    expect(text).toContain("Do not use a colon before tool calls");
    // Kako Explore has Glob/Grep/Read only — do not steer toward Bash find/grep.
    expect(text).not.toContain("Use `find` via Bash");
    expect(text).not.toContain("SendMessage");
    expect(text).not.toContain("Skill tool");
  });
});
