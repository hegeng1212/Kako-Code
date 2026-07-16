import { describe, expect, it } from "vitest";
import { decideWorkflowCompletionPresent } from "./workflow-completion-present.js";

describe("decideWorkflowCompletionPresent", () => {
  it("delivers immediately when foreground chat is idle", () => {
    expect(
      decideWorkflowCompletionPresent({
        isForegroundSession: true,
        agentsPanelOpen: false,
        turnInProgress: false,
      }),
    ).toBe("deliver_now");
  });

  it("queues without preview when a user turn is still in progress", () => {
    expect(
      decideWorkflowCompletionPresent({
        isForegroundSession: true,
        agentsPanelOpen: false,
        turnInProgress: true,
      }),
    ).toBe("queue_only");
  });

  it("queues and marks needs-input when Agents panel is open", () => {
    expect(
      decideWorkflowCompletionPresent({
        isForegroundSession: true,
        agentsPanelOpen: true,
        turnInProgress: false,
      }),
    ).toBe("queue_and_mark_ready");
  });

  it("queues and marks needs-input for background sessions", () => {
    expect(
      decideWorkflowCompletionPresent({
        isForegroundSession: false,
        agentsPanelOpen: false,
        turnInProgress: false,
      }),
    ).toBe("queue_and_mark_ready");
  });
});
