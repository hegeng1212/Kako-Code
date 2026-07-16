/**
 * How a workflow completion should surface in the foreground chat.
 *
 * When a user turn is already in progress, only queue the wake — never preview
 * the finished event line. Delivery appends that line once when the present
 * turn starts; preview+deliver was causing the "Dynamic … completed" double.
 */
export type WorkflowCompletionPresentMode =
  | "deliver_now"
  | "queue_only"
  | "queue_and_mark_ready";

export function decideWorkflowCompletionPresent(input: {
  isForegroundSession: boolean;
  agentsPanelOpen: boolean;
  turnInProgress: boolean;
}): WorkflowCompletionPresentMode {
  if (!input.isForegroundSession || input.agentsPanelOpen) {
    return "queue_and_mark_ready";
  }
  if (input.turnInProgress) {
    return "queue_only";
  }
  return "deliver_now";
}
