import { describe, expect, it } from "vitest";
import {
  formatInterruptedResumeHint,
  interruptedResumeHintKey,
} from "./interrupted-resume-hint.js";

describe("interrupted-resume-hint", () => {
  it("formats singular and plural hints", () => {
    expect(formatInterruptedResumeHint(1)).toContain("1 interrupted task");
    expect(formatInterruptedResumeHint(2)).toContain("2 interrupted tasks");
    expect(formatInterruptedResumeHint(1)).toContain("enter to resume");
    expect(formatInterruptedResumeHint(1).replace(/\x1b\[[0-9;]*m/g, "").startsWith("  ◉")).toBe(
      true,
    );
  });

  it("maps enter/escape keys", () => {
    expect(interruptedResumeHintKey("enter")).toBe("resume");
    expect(interruptedResumeHintKey("escape")).toBe("dismiss");
    expect(interruptedResumeHintKey("a")).toBe("ignore");
  });
});
