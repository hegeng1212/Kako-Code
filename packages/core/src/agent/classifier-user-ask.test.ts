import { describe, expect, it } from "vitest";
import { classifierUserAskForTurn } from "./runtime.js";

describe("classifierUserAskForTurn", () => {
  it("prefers visible user text", () => {
    expect(
      classifierUserAskForTurn({
        text: "继续执行",
        llmText: "<task-notification>x</task-notification>",
      }),
    ).toBe("继续执行");
  });

  it("uses a present-report ask for task-notification wakes", () => {
    expect(
      classifierUserAskForTurn({
        text: "",
        llmText: "<task-notification><status>completed</status></task-notification>",
      }),
    ).toMatch(/Present the completed background workflow/i);
  });

  it("uses a continue-task ask for last-BG plain result wakes", () => {
    expect(
      classifierUserAskForTurn({
        text: "",
        llmText: "## Project LLM summary\n\nFindings about Coze…",
      }),
    ).toMatch(/Incorporate the completed background agent findings/i);
  });

  it("uses a recap ask for stepped-away wakes", () => {
    expect(
      classifierUserAskForTurn({
        text: "",
        llmText:
          "[SYSTEM NOTIFICATION — NOT USER INPUT]\n<stepped-away-recap/>\nThe user stepped away and is coming back.",
      }),
    ).toMatch(/overall goal and current task/i);
  });
});
