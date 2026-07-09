import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerBackgroundTask,
  resetBackgroundTaskStore,
} from "../../background/task-store.js";
import {
  formatTaskStopResult,
  parseTaskStopInput,
  taskStopHandler,
  taskStopToolDefinition,
} from "./task-stop.js";
import { toolContext } from "./test-helpers.js";

describe("TaskStop tool definition", () => {
  it("exposes Claude-compatible schema fields", () => {
    const props = taskStopToolDefinition.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(["shell_id", "task_id"].sort());
    expect(taskStopToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(taskStopToolDefinition.inputSchema.required).toBeUndefined();
  });

  it("matches Claude Code description", () => {
    expect(taskStopToolDefinition.description).toContain("Stops a running background task");
    expect(taskStopToolDefinition.description).toContain("task_id");
    expect(taskStopToolDefinition.description).toContain("success or failure");
  });

  it("uses Claude Code parameter descriptions", () => {
    expect(taskStopToolDefinition.inputSchema.properties?.task_id?.description).toContain(
      "background task",
    );
    expect(taskStopToolDefinition.inputSchema.properties?.shell_id?.description).toContain(
      "Deprecated",
    );
  });
});

describe("parseTaskStopInput", () => {
  it("prefers task_id over shell_id", () => {
    expect(parseTaskStopInput({ task_id: "bg-1", shell_id: "bg-2" })).toBe("bg-1");
  });

  it("accepts legacy shell_id", () => {
    expect(parseTaskStopInput({ shell_id: "bg-legacy" })).toBe("bg-legacy");
  });

  it("requires an id", () => {
    expect(() => parseTaskStopInput({})).toThrow(/task_id/);
  });
});

describe("taskStopHandler", () => {
  afterEach(() => {
    resetBackgroundTaskStore();
  });

  it("stops a registered background task", async () => {
    const abort = vi.fn();
    registerBackgroundTask("sess-stop", "bg-abc", "monitor", abort);

    const json = await taskStopHandler(
      { task_id: "bg-abc" },
      toolContext("/tmp", { sessionId: "sess-stop" }),
    );
    const parsed = JSON.parse(String(json));
    expect(parsed).toEqual({ success: true, taskId: "bg-abc" });
    expect(abort).toHaveBeenCalledOnce();
  });

  it("returns failure when task is missing", async () => {
    const json = await taskStopHandler(
      { task_id: "bg-missing" },
      toolContext("/tmp", { sessionId: "sess-stop" }),
    );
    const parsed = JSON.parse(String(json));
    expect(parsed.success).toBe(false);
    expect(parsed.taskId).toBe("bg-missing");
    expect(parsed.message).toContain("not found");
  });

  it("returns failure when task already stopped", async () => {
    registerBackgroundTask("sess-stop", "bg-done", "bash", () => {});

    await taskStopHandler(
      { task_id: "bg-done" },
      toolContext("/tmp", { sessionId: "sess-stop" }),
    );
    const json = await taskStopHandler(
      { task_id: "bg-done" },
      toolContext("/tmp", { sessionId: "sess-stop" }),
    );
    const parsed = JSON.parse(String(json));
    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain("already stopped");
  });
});

describe("formatTaskStopResult", () => {
  it("serializes result", () => {
    const json = formatTaskStopResult({ success: true, taskId: "bg-1" });
    expect(JSON.parse(json)).toEqual({ success: true, taskId: "bg-1" });
  });
});
