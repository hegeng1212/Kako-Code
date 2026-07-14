import { describe, expect, it } from "vitest";
import { generatePlanFileBase } from "./plan-file-name.js";

describe("generatePlanFileBase", () => {
  it("builds topic-adjective-animal basename", () => {
    const base = generatePlanFileBase("API design");
    expect(base).toMatch(/^api-[a-z]+-[a-z]+$/);
  });

  it("falls back to plan prefix for generic titles", () => {
    const base = generatePlanFileBase("New chat");
    expect(base).toMatch(/^plan-[a-z]+-[a-z]+$/);
  });
});
