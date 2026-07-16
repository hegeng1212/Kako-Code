/**
 * Agents reply to a session that still has resumable interrupted checkpoints
 * should open the resume-approval path — not a freestanding chat turn that
 * finishes as Done · 0s without relaunching soft-resume work.
 */
export function agentsReplyShouldResumeInterrupted(
  resumableInterruptedCount: number,
): boolean {
  return resumableInterruptedCount > 0;
}
