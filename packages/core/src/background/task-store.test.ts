import { describe, expect, it, beforeEach } from "vitest";
import {
  listAllBackgroundTasks,
  registerBackgroundTask,
  resetBackgroundTaskStore,
  sessionsWithRunningBackgroundWork,
  completeBackgroundTask,
} from "./task-store.js";

describe("background task store", () => {
  beforeEach(() => {
    resetBackgroundTaskStore();
  });

  it("tracks sessions with running agent or workflow tasks", () => {
    registerBackgroundTask("sess-a", "w1", "workflow", () => {});
    registerBackgroundTask("sess-b", "a1", "agent", () => {});
    registerBackgroundTask("sess-c", "m1", "monitor", () => {});
    expect([...sessionsWithRunningBackgroundWork()].sort()).toEqual(["sess-a", "sess-b"]);
    expect(listAllBackgroundTasks()).toHaveLength(3);
  });

  it("drops completed tasks from the running set", () => {
    registerBackgroundTask("sess-a", "w1", "workflow", () => {});
    completeBackgroundTask("sess-a", "w1");
    expect(sessionsWithRunningBackgroundWork().has("sess-a")).toBe(false);
  });
});
