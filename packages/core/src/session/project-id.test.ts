import { describe, expect, it } from "vitest";
import { projectIdFromCwd } from "./project-id.js";

describe("projectIdFromCwd", () => {
  it("returns stable proj- prefix id", () => {
    const a = projectIdFromCwd("/tmp/my-project");
    const b = projectIdFromCwd("/tmp/my-project");
    expect(a).toBe(b);
    expect(a).toMatch(/^proj-[a-f0-9]{12}$/);
  });
});
