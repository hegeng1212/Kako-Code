import { afterEach, describe, expect, it } from "vitest";
import { createTask, parseTaskGetInput, resetTaskStore } from "../../tasks/task-store.js";
import {
  formatTaskGetResult,
  taskGetHandler,
  taskGetToolDefinition,
  toTaskGetResult,
} from "./task-get.js";
import { toolContext } from "./test-helpers.js";

describe("TaskGet tool definition", () => {
  it("exposes Claude-compatible schema fields", () => {
    const props = taskGetToolDefinition.inputSchema.properties!;
    expect(Object.keys(props)).toEqual(["taskId"]);
    expect(taskGetToolDefinition.inputSchema.required).toEqual(["taskId"]);
    expect(taskGetToolDefinition.inputSchema.additionalProperties).toBe(false);
  });

  it("matches Claude Code description", () => {
    expect(taskGetToolDefinition.description).toContain("retrieve a task by its ID");
    expect(taskGetToolDefinition.description).toContain("blockedBy");
    expect(taskGetToolDefinition.description).toContain("TaskList");
  });
});

describe("parseTaskGetInput", () => {
  it("parses taskId", () => {
    expect(parseTaskGetInput({ taskId: "task-abc123" })).toBe("task-abc123");
  });

  it("requires taskId", () => {
    expect(() => parseTaskGetInput({ taskId: "  " })).toThrow(/taskId/);
  });
});

describe("toTaskGetResult", () => {
  it("defaults blocks and blockedBy to empty arrays", () => {
    const result = toTaskGetResult({
      id: "task-1",
      sessionId: "sess",
      subject: "Ship",
      description: "Deploy",
      status: "pending",
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    expect(result.blocks).toEqual([]);
    expect(result.blockedBy).toEqual([]);
  });

  it("includes dependency lists when set", () => {
    const result = toTaskGetResult({
      id: "task-2",
      sessionId: "sess",
      subject: "Ship",
      description: "Deploy",
      status: "in_progress",
      blocks: ["task-3"],
      blockedBy: ["task-1"],
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    expect(result.blocks).toEqual(["task-3"]);
    expect(result.blockedBy).toEqual(["task-1"]);
    expect(result.status).toBe("in_progress");
  });
});

describe("taskGetHandler", () => {
  afterEach(() => {
    resetTaskStore();
  });

  it("returns full task details", async () => {
    const created = createTask("sess-task-get", {
      subject: "Fix auth",
      description: "Patch login flow",
      activeForm: "Fixing auth",
      metadata: { area: "backend" },
    });

    const json = await taskGetHandler(
      { taskId: created.id },
      toolContext("/tmp", { sessionId: "sess-task-get" }),
    );
    const parsed = JSON.parse(String(json));
    expect(parsed.id).toBe(created.id);
    expect(parsed.subject).toBe("Fix auth");
    expect(parsed.description).toBe("Patch login flow");
    expect(parsed.status).toBe("pending");
    expect(parsed.blocks).toEqual([]);
    expect(parsed.blockedBy).toEqual([]);
    expect(parsed.activeForm).toBe("Fixing auth");
    expect(parsed.metadata).toEqual({ area: "backend" });
  });

  it("rejects unknown task id", async () => {
    await expect(
      taskGetHandler(
        { taskId: "task-missing" },
        toolContext("/tmp", { sessionId: "sess-task-get" }),
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("formatTaskGetResult", () => {
  it("serializes result", () => {
    const json = formatTaskGetResult({
      id: "task-abc",
      subject: "Test",
      description: "Details",
      status: "completed",
      blocks: [],
      blockedBy: [],
    });
    expect(JSON.parse(json).status).toBe("completed");
  });
});
