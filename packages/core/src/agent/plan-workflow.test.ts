import { describe, expect, it } from "vitest";
import { formatPlanWorkflowReminder } from "./plan-workflow.js";

describe("plan-workflow", () => {
  it("loads bundled plan-workflow template from dist-like module location", async () => {
    const reminder = await formatPlanWorkflowReminder("/tmp/plan.md");
    expect(reminder).toContain("<system-reminder>");
    expect(reminder).toContain("/tmp/plan.md");
    expect(reminder.length).toBeGreaterThan(50);
  });
});
