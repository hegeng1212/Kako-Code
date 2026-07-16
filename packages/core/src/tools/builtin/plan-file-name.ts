import { randomInt } from "node:crypto";

const ADJECTIVES = [
  "swift",
  "calm",
  "bright",
  "clever",
  "gentle",
  "nimble",
  "purrfect",
  "quiet",
  "steady",
  "vivid",
] as const;

const ANIMALS = [
  "wren",
  "fox",
  "owl",
  "lynx",
  "hare",
  "crane",
  "otter",
  "finch",
  "panda",
  "koala",
] as const;

function topicPrefix(hint?: string): string {
  const trimmed = (hint ?? "").trim();
  if (!trimmed || trimmed === "New chat" || trimmed === "new session") return "plan";
  const firstWord = trimmed.split(/\s+/)[0] ?? "";
  const slug = firstWord
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12);
  return slug || "plan";
}

/** Claude Code-style plan basename, e.g. api-purrfect-wren */
export function generatePlanFileBase(topicHint?: string): string {
  const prefix = topicPrefix(topicHint);
  const adj = ADJECTIVES[randomInt(ADJECTIVES.length)]!;
  const animal = ANIMALS[randomInt(ANIMALS.length)]!;
  return `${prefix}-${adj}-${animal}`;
}
