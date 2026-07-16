import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import { activityFormFromTasks, renderTaskListBlockLines } from "./task-list-display.js";

describe("task-list-display", () => {
  it("renders pending and completed subjects", () => {
    const lines = renderTaskListBlockLines([
      { id: "1", subject: "Add mode footer", status: "completed" },
      { id: "2", subject: "Wire slash commands", status: "pending" },
    ]).map(stripAnsi);
    expect(lines.some((l) => l.includes("Add mode footer"))).toBe(true);
    expect(lines.some((l) => l.includes("Wire slash commands"))).toBe(true);
  });

  it("prefers activeForm for in_progress activity", () => {
    expect(
      activityFormFromTasks(
        [{ id: "1", subject: "Ship", status: "in_progress" }],
        { "1": "Shipping footer patch" },
      ),
    ).toBe("Shipping footer patch");
  });
});
