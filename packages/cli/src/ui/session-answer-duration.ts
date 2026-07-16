import type { TranscriptMessage } from "@kako/shared";
import { chatTurnsFromTranscript } from "./session-history.js";

/**
 * Sum of chat "Worked for" wall-clock time across turns (not session age).
 * Matches {@link chatTurnsFromTranscript}: each turn is user prompt start → last
 * assistant/tool message before the next display user prompt.
 */
export function sessionAnswerDurationMs(transcript: TranscriptMessage[]): number {
  const turns = chatTurnsFromTranscript(transcript);
  let total = 0;
  for (const turn of turns) {
    if (turn.harnessOnly) continue;
    if (turn.finishedAt == null) continue;
    total += Math.max(0, turn.finishedAt - turn.thinkingStartedAt);
  }
  return total;
}

/** Compact duration for Agents time column (e.g. 12s, 5m, 2h). Empty when under 1s. */
export function formatAnswerDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 1) return "";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}
