import { afterEach, describe, expect, it } from "vitest";
import { createTask, resetTaskStore } from "../../tasks/task-store.js";
import {
  formatTaskListResult,
  taskListHandler,
  taskListToolDefinition,
  toTaskListSummary,
} from "./task-list.js";
import { toolContext } from "./test-helpers.js";

describe("TaskList tool definition", () => {
  it("exposes Claude-compatible empty schema", () => {
    expect(taskListToolDefinition.inputSchema.properties).toEqual({});
    expect(taskListToolDefinition.inputSchema.additionalProperties).toBe(false);
  });

  it("matches Claude Code description", () => {
    expect(taskListToolDefinition.description).toContain("list all tasks");
    expect(taskListToolDefinition.description).toContain("owner");
    expect(taskListToolDefinition.description).toContain("ID order");
    expect(taskListToolDefinition.description).toContain("TaskGet");
  });
});

describe("toTaskListSummary", () => {
  afterEach(() => {
    resetTaskStore();
  });

  it("returns empty owner and open blockedBy only", () => {
    const sessionId = "sess-summary";
    const blocker = createTask(sessionId, { subject: "A", description: "first" });
    const blocked = createTask(sessionId, { subject: "B", description: "second" });
    blocked.blockedBy = [blocker.id, "task-missing"];

    const summary = toTaskListSummary(sessionId, blocked);
    expect(summary.owner).toBe("");
    expect(summary.blockedBy).toEqual([blocker.id]);
  });
});

describe("taskListHandler", () => {
  afterEach(() => {
    resetTaskStore();
  });

  it("returns tasks sorted by id with summaries", async () => {
    const sessionId = "sess-task-list";
    const first = createTask(sessionId, { subject: "First", description: "one" });
    const second = createTask(sessionId, { subject: "Second", description: "two" });
    second.owner = "agent-main";
    second.status = "in_progress";

    const json = await taskListHandler({}, toolContext("/tmp", { sessionId }));
    const parsed = JSON.parse(String(json)) as { tasks: Array<{ id: string; owner: string }> };
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[0]?.id.localeCompare(parsed.tasks[1]?.id ?? "")).toBeLessThanOrEqual(0);
    const secondSummary = parsed.tasks.find((task) => task.id === second.id);
    expect(secondSummary?.owner).toBe("agent-main");
    expect(parsed.tasks.some((task) => task.id === first.id)).toBe(true);
  });

  it("returns empty list when no tasks", async () => {
    const json = await taskListHandler({}, toolContext("/tmp", { sessionId: "sess-empty" }));
    expect(JSON.parse(String(json))).toEqual({ tasks: [] });
  });
});

describe("formatTaskListResult", () => {
  it("serializes tasks array", () => {
    const json = formatTaskListResult([
      {
        id: "task-1",
        subject: "Ship",
        status: "pending",
        owner: "",
        blockedBy: [],
      },
    ]);
    expect(JSON.parse(json).tasks).toHaveLength(1);
  });
});
