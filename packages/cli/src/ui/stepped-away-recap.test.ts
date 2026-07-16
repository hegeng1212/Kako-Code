import { describe, expect, it } from "vitest";
import {
  STEPPED_AWAY_RECAP_INSTRUCTION,
  STEPPED_AWAY_RECAP_MARKER,
  buildSteppedAwayRecapWakeMessage,
  isSteppedAwayRecapWake,
  scrubRecapMarkdown,
  truncateRecapDetail,
} from "./stepped-away-recap.js";

describe("stepped-away-recap", () => {
  it("builds a wake whose instruction matches Claude Code stepped-away copy", () => {
    const wake = buildSteppedAwayRecapWakeMessage();
    expect(wake).toContain("[SYSTEM NOTIFICATION — NOT USER INPUT]");
    expect(wake).toContain(STEPPED_AWAY_RECAP_MARKER);
    expect(wake).toContain(STEPPED_AWAY_RECAP_INSTRUCTION);
    expect(STEPPED_AWAY_RECAP_INSTRUCTION).toBe(
      "The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no markdown. Lead with the overall goal and current task, then the one next action. Skip root-cause narrative, fix internals, secondary to-dos, and em-dash tangents.",
    );
    expect(wake).toMatch(/under 40 words/i);
    expect(wake).toMatch(/1-2 plain sentences/i);
    expect(wake).toMatch(/overall goal and current task/i);
    expect(wake).toMatch(/one next action/i);
    expect(wake).toMatch(/no markdown/i);
    expect(isSteppedAwayRecapWake(wake)).toBe(true);
  });

  it("scrubs markdown to plain text for recap display", () => {
    expect(scrubRecapMarkdown("**Goal:** ship the API. Next: write tests.")).toBe(
      "Goal: ship the API. Next: write tests.",
    );
    expect(scrubRecapMarkdown("# Heading\n\n- step one")).toBe("Heading step one");
    expect(scrubRecapMarkdown("`code` and [link](https://x.test)")).toBe("code and link");
  });

  it("truncates detail to at most 64 characters", () => {
    const long = "a".repeat(80);
    expect(truncateRecapDetail(long)).toHaveLength(64);
    expect(truncateRecapDetail("short")).toBe("short");
  });
});
