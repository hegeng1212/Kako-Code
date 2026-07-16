import { describe, expect, it } from "vitest";
import { agentsReplyShouldResumeInterrupted } from "./agents-reply-interrupted.js";

describe("agentsReplyShouldResumeInterrupted", () => {
  it("routes reply through resume when checkpoints remain", () => {
    expect(agentsReplyShouldResumeInterrupted(1)).toBe(true);
    expect(agentsReplyShouldResumeInterrupted(3)).toBe(true);
  });

  it("keeps normal reply turns when nothing is interrupted", () => {
    expect(agentsReplyShouldResumeInterrupted(0)).toBe(false);
  });
});
