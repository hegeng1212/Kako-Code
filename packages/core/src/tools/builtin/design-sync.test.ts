import { describe, expect, it } from "vitest";
import { designSyncToolDefinition } from "./design-sync.js";

describe("DesignSync tool definition", () => {
  it("preserves Claude Code description and method dispatch schema", () => {
    expect(designSyncToolDefinition.description).toContain("claude.ai/design");
    expect(designSyncToolDefinition.description).toContain("finalize_plan");
    expect(designSyncToolDefinition.inputSchema.required).toEqual(["method"]);
  });
});
