import { describe, expect, it } from "vitest";
import { formatDurationMs, formatDurationSeconds } from "./format-duration.js";

describe("formatDurationSeconds", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatDurationSeconds(0)).toBe("0s");
    expect(formatDurationSeconds(45)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDurationSeconds(437)).toBe("7m 17s");
    expect(formatDurationSeconds(125)).toBe("2m 5s");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatDurationSeconds(3661)).toBe("1h 1m 1s");
    expect(formatDurationSeconds(7200)).toBe("2h 0m 0s");
  });
});

describe("formatDurationMs", () => {
  it("converts milliseconds to hms", () => {
    expect(formatDurationMs(437_000)).toBe("7m 17s");
  });
});
