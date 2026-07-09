import { describe, expect, it } from "vitest";
import { formatActiveSkillReminder } from "../tools/builtin/skill.js";
import type { RunTurnOptions } from "../agent/runtime.js";

describe("RunTurnOptions preactivatedSkill", () => {
  it("documents slash harness pre-load shape", () => {
    const options: RunTurnOptions = {
      preactivatedSkill: {
        name: "init",
        instructions: "# Init KAKO.md\n\nCreate project docs.",
      },
    };
    const reminder = formatActiveSkillReminder(
      options.preactivatedSkill!.name,
      options.preactivatedSkill!.instructions,
    );
    expect(reminder).toContain("Active skill: **init**");
    expect(reminder).toContain("Init KAKO.md");
  });
});
