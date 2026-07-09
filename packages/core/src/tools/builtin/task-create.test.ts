import { afterEach, describe, expect, it } from "vitest";
import { getTask, listTasks, parseTaskCreateInput, resetTaskStore } from "../../tasks/task-store.js";
import {
  formatTaskCreateResult,
  taskCreateHandler,
  taskCreateToolDefinition,
  toTaskCreateResult,
} from "./task-create.js";
import { toolContext } from "./test-helpers.js";

describe("TaskCreate tool definition", () => {
  it("exposes Claude-compatible schema fields", () => {
    const props = taskCreateToolDefinition.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(
      ["activeForm", "description", "metadata", "subject"].sort(),
    );
    expect(taskCreateToolDefinition.inputSchema.required).toEqual(["subject", "description"]);
    expect(taskCreateToolDefinition.inputSchema.additionalProperties).toBe(false);
  });

  it("matches Claude Code description", () => {
    expect(taskCreateToolDefinition.description).toContain("structured task list");
    expect(taskCreateToolDefinition.description).toContain("Plan mode");
    expect(taskCreateToolDefinition.description).toContain("TaskUpdate");
    expect(taskCreateToolDefinition.description).toContain("TaskList");
    expect(taskCreateToolDefinition.description).toContain("`pending`");
  });

  it("uses Claude Code parameter descriptions", () => {
    expect(taskCreateToolDefinition.inputSchema.properties?.subject?.description).toContain("title");
    expect(taskCreateToolDefinition.inputSchema.properties?.activeForm?.description).toContain(
      "spinner",
    );
    expect(taskCreateToolDefinition.inputSchema.properties?.metadata?.description).toContain(
      "metadata",
    );
  });
});

describe("parseTaskCreateInput", () => {
  afterEach(() => {
    resetTaskStore();
  });

  it("parses required fields", () => {
    const parsed = parseTaskCreateInput({
      subject: "Fix login bug",
      description: "Investigate and patch auth flow",
    });
    expect(parsed).toEqual({
      subject: "Fix login bug",
      description: "Investigate and patch auth flow",
      activeForm: undefined,
      metadata: undefined,
    });
  });

  it("parses optional activeForm and metadata", () => {
    const parsed = parseTaskCreateInput({
      subject: "Run tests",
      description: "Execute full test suite",
      activeForm: "Running tests",
      metadata: { priority: "high" },
    });
    expect(parsed.activeForm).toBe("Running tests");
    expect(parsed.metadata).toEqual({ priority: "high" });
  });

  it("requires subject and description", () => {
    expect(() => parseTaskCreateInput({ subject: "  ", description: "x" })).toThrow(/subject/);
    expect(() => parseTaskCreateInput({ subject: "x", description: "  " })).toThrow(/description/);
  });

  it("rejects non-object metadata", () => {
    expect(() =>
      parseTaskCreateInput({ subject: "x", description: "y", metadata: "bad" }),
    ).toThrow(/metadata/);
  });
});

describe("taskCreateHandler", () => {
  afterEach(() => {
    resetTaskStore();
  });

  it("creates a pending task and returns JSON", async () => {
    const json = await taskCreateHandler(
      {
        subject: "Add API endpoint",
        description: "Implement POST /api/v1/items",
        activeForm: "Adding API endpoint",
      },
      toolContext("/tmp", { sessionId: "sess-task-1" }),
    );
    const parsed = JSON.parse(String(json));
    expect(parsed.id).toMatch(/^task-/);
    expect(parsed.status).toBe("pending");
    expect(parsed.subject).toBe("Add API endpoint");
    expect(parsed.activeForm).toBe("Adding API endpoint");

    const stored = getTask("sess-task-1", parsed.id);
    expect(stored?.status).toBe("pending");
    expect(listTasks("sess-task-1")).toHaveLength(1);
  });
});

describe("formatTaskCreateResult", () => {
  it("serializes result", () => {
    const json = formatTaskCreateResult(
      toTaskCreateResult({
        id: "task-abc",
        subject: "Ship feature",
        description: "Finish rollout",
      }),
    );
    expect(JSON.parse(json).status).toBe("pending");
  });
});
