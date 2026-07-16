import { randomUUID } from "node:crypto";
import type { SessionId, TranscriptMessage } from "@kako/shared";
import { consolidateToL1 } from "./compact.js";
import { draftL1FromTranscript, L1_SECTION_HEADERS } from "./l1.js";
import { FileMemoryStore } from "./store.js";

export type RewindSummarizeMode = "from_here" | "up_to_here";

export interface SummarizeTranscriptRangeOptions {
  sessionId: SessionId;
  /** L0 index of the selected display user message. */
  selectedUserIndex: number;
  mode: RewindSummarizeMode;
  /** Optional user note for Summarize actions. */
  context?: string;
}

/** End index (exclusive) of the turn that starts at `selectedUserIndex`. */
export function selectedTurnEndIndex(
  transcript: TranscriptMessage[],
  selectedUserIndex: number,
): number {
  for (let i = selectedUserIndex + 1; i < transcript.length; i++) {
    if (transcript[i]!.role === "user") return i;
  }
  return transcript.length;
}

function formatCollapsedSummary(
  collapsed: TranscriptMessage[],
  context?: string,
): string {
  const draft = draftL1FromTranscript(collapsed);
  const lines: string[] = ["# Conversation summary", ""];
  const note = context?.trim();
  if (note) {
    lines.push(`User context: ${note}`, "");
  }
  for (const name of L1_SECTION_HEADERS) {
    const body = (draft[name] ?? "").trim();
    if (!body || body === "(none)") continue;
    lines.push(`## ${name}`, body, "");
  }
  if (lines.length <= 2) {
    lines.push("(no content)");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function summaryMessage(content: string): TranscriptMessage {
  return {
    id: randomUUID(),
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    metadata: { rewindSummary: true },
  };
}

/**
 * Collapse a transcript range into one summary assistant row (Rewind UI).
 * Updates L1 for the collapsed slice, then rewrites L0.
 */
export async function summarizeTranscriptRange(
  options: SummarizeTranscriptRangeOptions,
): Promise<void> {
  const store = new FileMemoryStore(options.sessionId);
  const transcript = await store.loadTranscript();
  const selected = options.selectedUserIndex;
  if (selected < 0 || selected >= transcript.length) return;
  if (transcript[selected]!.role !== "user") return;

  const turnEnd = selectedTurnEndIndex(transcript, selected);
  let keep: TranscriptMessage[];
  let collapsed: TranscriptMessage[];

  if (options.mode === "from_here") {
    keep = transcript.slice(0, turnEnd);
    collapsed = transcript.slice(turnEnd);
  } else {
    keep = transcript.slice(selected);
    collapsed = transcript.slice(0, selected);
  }

  if (collapsed.length === 0) return;

  await consolidateToL1({
    sessionId: options.sessionId,
    transcript: collapsed,
  });

  const summary = summaryMessage(formatCollapsedSummary(collapsed, options.context));
  const next =
    options.mode === "from_here" ? [...keep, summary] : [summary, ...keep];
  await store.rewriteTranscript(next);
}
