import { afterEach, describe, expect, it } from "vitest";
import {
  createTask,
  getTask,
  parseTaskUpdateInput,
  resetTaskStore,
} from "../../tasks/task-store.js";
import {
  formatTaskUpdateResult,
  taskUpdateHandler,
  taskUpdateToolDefinition,
} from "./task-update.js";
import { toolContext } from "./test-helpers.js";

describe("TaskUpdate tool definition", () => {
  it("exposes Claude-compatible schema fields", () => {
    const props = taskUpdateToolDefinition.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(
      [
        "activeForm",
        "addBlockedBy",
        "addBlocks",
        "description",
        "metadata",
        "owner",
        "status",
        "subject",
        "taskId",
      ].sort(),
    );
    expect(taskUpdateToolDefinition.inputSchema.required).toEqual(["taskId"]);
    expect(taskUpdateToolDefinition.inputSchema.additionalProperties).toBe(false);
  });

  it("matches Claude Code description", () => {
    expect(taskUpdateToolDefinition.description).toContain("update a task");
    expect(taskUpdateToolDefinition.description).toContain("addBlockedBy");
    expect(taskUpdateToolDefinition.description).toContain("`deleted`");
    expect(taskUpdateToolDefinition.description).toContain("TaskGet");
  });

  it("uses status enum including deleted", () => {
    expect(taskUpdateToolDefinition.inputSchema.properties?.status?.enum).toEqual([
      "pending",
      "in_progress",
      "completed",
      "deleted",
    ]);
  });
});

describe("parseTaskUpdateInput", () => {
  it("parses partial updates", () => {
    expect(parseTaskUpdateInput({ taskId: "task-1", status: "in_progress" })).toEqual({
      taskId: "task-1",
      status: "in_progress",
    });
  });

  it("requires taskId and at least one change", () => {
    expect(() => parseTaskUpdateInput({ taskId: "task-1" })).toThrow(/at least one field/);
    expect(() => parseTaskUpdateInput({ status: "completed" })).toThrow(/taskId/);
  });
});

describe("taskUpdateHandler", () => {
  afterEach(() => {
    resetTaskStore();
  });

  it("updates status and owner", async () => {
    const sessionId = "sess-update";
    const task = createTask(sessionId, { subject: "Run tests", description: "Execute suite" });

    const json = await taskUpdateHandler(
      { taskId: task.id, status: "in_progress", owner: "agent-main" },
      toolContext("/tmp", { sessionId }),
    );
    const parsed = JSON.parse(String(json));
    expect(parsed.status).toBe("in_progress");
    expect(parsed.id).toBe(task.id);
    expect(getTask(sessionId, task.id)?.owner).toBe("agent-main");
  });

  it("deletes a task when status is deleted", async () => {
    const sessionId = "sess-delete";
    const task = createTask(sessionId, { subject: "Old", description: "remove me" });

    const json = await taskUpdateHandler(
      { taskId: task.id, status: "deleted" },
      toolContext("/tmp", { sessionId }),
    );
    expect(JSON.parse(String(json))).toEqual({ taskId: task.id, deleted: true });
    expect(getTask(sessionId, task.id)).toBeUndefined();
  });

  it("links blockedBy dependencies bidirectionally", async () => {
    const sessionId = "sess-deps";
    const first = createTask(sessionId, { subject: "First", description: "one" });
    const second = createTask(sessionId, { subject: "Second", description: "two" });

    await taskUpdateHandler(
      { taskId: second.id, addBlockedBy: [first.id] },
      toolContext("/tmp", { sessionId }),
    );

    expect(getTask(sessionId, second.id)?.blockedBy).toEqual([first.id]);
    expect(getTask(sessionId, first.id)?.blocks).toEqual([second.id]);
  });

  it("merges metadata and removes null keys", async () => {
    const sessionId = "sess-meta";
    const task = createTask(sessionId, {
      subject: "Meta",
      description: "data",
      metadata: { keep: "yes", drop: "old" },
    });

    await taskUpdateHandler(
      {
        taskId: task.id,
        metadata: { drop: null, added: "new" },
      },
      toolContext("/tmp", { sessionId }),
    );

    expect(getTask(sessionId, task.id)?.metadata).toEqual({ keep: "yes", added: "new" });
  });
});

describe("formatTaskUpdateResult", () => {
  it("serializes delete result", () => {
    const json = formatTaskUpdateResult({ taskId: "task-1", deleted: true });
    expect(JSON.parse(json)).toEqual({ taskId: "task-1", deleted: true });
  });
});
