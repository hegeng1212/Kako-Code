import { describe, expect, it } from "vitest";
import {
  INPUT_PLACEHOLDER_SUGGESTIONS,
  pickInputPlaceholder,
} from "./input-placeholders.js";

describe("input-placeholders", () => {
  it("exposes several Try suggestions", () => {
    expect(INPUT_PLACEHOLDER_SUGGESTIONS.length).toBeGreaterThanOrEqual(4);
    expect(INPUT_PLACEHOLDER_SUGGESTIONS.every((s) => s.startsWith('Try "'))).toBe(true);
  });

  it("picks a deterministic suggestion from a stub RNG", () => {
    expect(pickInputPlaceholder(INPUT_PLACEHOLDER_SUGGESTIONS, () => 0)).toBe(
      INPUT_PLACEHOLDER_SUGGESTIONS[0],
    );
    expect(pickInputPlaceholder(INPUT_PLACEHOLDER_SUGGESTIONS, () => 0.99)).toBe(
      INPUT_PLACEHOLDER_SUGGESTIONS[INPUT_PLACEHOLDER_SUGGESTIONS.length - 1],
    );
  });
});
