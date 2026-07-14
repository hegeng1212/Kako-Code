import { describe, expect, it } from "vitest";
import { parseTaskOutputInput, taskOutputToolDefinition } from "./task-output.js";

describe("TaskOutput tool definition", () => {
  it("preserves Claude Code description and schema", () => {
    expect(taskOutputToolDefinition.description).toContain("Retrieves output from a running or completed task");
    expect(taskOutputToolDefinition.inputSchema.required).toEqual(["task_id", "block", "timeout"]);
  });

  it("accepts legacy shell_id alias", () => {
    expect(parseTaskOutputInput({ shell_id: "bg-1", block: false, timeout: 1000 }).taskId).toBe(
      "bg-1",
    );
  });
});
