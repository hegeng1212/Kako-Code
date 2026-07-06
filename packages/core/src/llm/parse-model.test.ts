import { describe, expect, it } from "vitest";
import { parseModel } from "./parse-model.js";

describe("parseModel", () => {
  it("parses provider/model format", () => {
    expect(parseModel("anthropic/claude-sonnet-4-20250514")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });
  });

  it("defaults to anthropic when no slash", () => {
    expect(parseModel("gpt-4o")).toEqual({
      provider: "anthropic",
      model: "gpt-4o",
    });
  });
});
