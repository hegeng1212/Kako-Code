import { describe, expect, it, beforeEach } from "vitest";
import { createTask, listTasks, resetTaskStore } from "./task-store.js";

describe("task-store session isolation", () => {
  beforeEach(() => {
    resetTaskStore();
  });

  it("keeps tasks partitioned by sessionId under concurrent creates", async () => {
    await Promise.all([
      Promise.resolve(createTask("sess-a", { subject: "A1", description: "da" })),
      Promise.resolve(createTask("sess-b", { subject: "B1", description: "db" })),
      Promise.resolve(createTask("sess-a", { subject: "A2", description: "da2" })),
    ]);
    expect(listTasks("sess-a").map((t) => t.subject).sort()).toEqual(["A1", "A2"]);
    expect(listTasks("sess-b").map((t) => t.subject)).toEqual(["B1"]);
  });
});
