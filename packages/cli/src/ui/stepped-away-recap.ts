/** Stepped-away / refocus recap wake — protocol text only; does not route tools or modes. */

export const STEPPED_AWAY_RECAP_MARKER = "<stepped-away-recap/>";

export const STEPPED_AWAY_IDLE_MS = 60_000;

/**
 * Claude Code harness wake copy (user-role inject). Kept verbatim for model parity.
 * @see Claude stepped-away return wake
 */
export const STEPPED_AWAY_RECAP_INSTRUCTION =
  "The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no markdown. Lead with the overall goal and current task, then the one next action. Skip root-cause narrative, fix internals, secondary to-dos, and em-dash tangents.";

/**
 * Fixed English wake injected as non-user llmText so the model writes a short recap.
 * Instruction body matches Claude Code; marker + preamble are Kako protocol only
 * (mute chat chrome, skip transcript fold-in, classifier ask).
 */
export function buildSteppedAwayRecapWakeMessage(): string {
  return [
    "[SYSTEM NOTIFICATION — NOT USER INPUT]",
    STEPPED_AWAY_RECAP_MARKER,
    STEPPED_AWAY_RECAP_INSTRUCTION,
  ].join("\n");
}

export function isSteppedAwayRecapWake(llmText: string | undefined | null): boolean {
  return Boolean(llmText?.includes(STEPPED_AWAY_RECAP_MARKER));
}

/** Scrub common markdown so UI/detail show plain prose. */
export function scrubRecapMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateRecapDetail(text: string, max = 64): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}

/** Prefer first 1–2 sentences, capped for turn.recapText display. */
export function normalizeRecapText(raw: string, maxChars = 120): string {
  const plain = scrubRecapMarkdown(raw);
  if (!plain) return "";
  const sentences = plain.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [plain];
  const kept = sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  if (kept.length <= maxChars) return kept;
  return `${kept.slice(0, Math.max(0, maxChars - 1))}…`;
}
