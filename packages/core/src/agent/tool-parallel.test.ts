import { describe, expect, it } from "vitest";
import {
  isToolParallelizable,
  partitionToolCallClusters,
} from "./tool-parallel.js";

describe("isToolParallelizable", () => {
  it("allows Agent and Workflow", () => {
    expect(isToolParallelizable("Agent")).toBe(true);
    expect(isToolParallelizable("Workflow")).toBe(true);
  });

  it("allows readonly tools from metadata", () => {
    expect(isToolParallelizable("Read", { security: { readonly: true } })).toBe(true);
    expect(isToolParallelizable("Grep", { security: { readonly: true } })).toBe(true);
  });

  it("force-serial overrides readonly metadata for AskUserQuestion and Skill", () => {
    expect(isToolParallelizable("AskUserQuestion", { security: { readonly: true } })).toBe(false);
    expect(isToolParallelizable("Skill", { security: { readonly: true } })).toBe(false);
  });

  it("rejects Write/Edit/Bash/TaskCreate", () => {
    expect(isToolParallelizable("Write", { security: { sideEffect: true } })).toBe(false);
    expect(isToolParallelizable("TaskCreate")).toBe(false);
    expect(isToolParallelizable("TaskUpdate")).toBe(false);
  });
});

describe("partitionToolCallClusters", () => {
  const defs: Record<string, { security?: { readonly?: boolean; sideEffect?: boolean } }> = {
    Read: { security: { readonly: true } },
    Grep: { security: { readonly: true } },
    Write: { security: { sideEffect: true } },
    Agent: {},
  };

  it("clusters Read+Grep+Agent then splits on Write", () => {
    const names = ["Read", "Grep", "Agent", "Write", "Read"];
    const parts = partitionToolCallClusters(
      names.map((name) => ({ name })),
      (n) => defs[n],
    );
    expect(parts).toEqual([
      { parallel: true, indices: [0, 1, 2] },
      { parallel: false, indices: [3] },
      { parallel: true, indices: [4] },
    ]);
  });
});
