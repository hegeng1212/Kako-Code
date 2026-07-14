import type { FactMergeDecision, MemoryFlushPayload } from "@kako/shared";

/** Schema-only flush instruction — no scenario examples. */
export const FLUSH_SYSTEM_PROMPT = `You extract durable session state into JSON only.
Return a single JSON object with keys:
- l1: object with string fields Goal, Decisions+Why, Files touched, Open questions, Next, and optional Historical Context
- facts: array of { action: ADD|UPDATE|DELETE|NOOP, factId?, content?, confidence?, reason }
- pins: array of short verbatim strings (paths, identifiers, open items)

Rules:
- Use only information present in the provided transcript/summary.
- Prefer concise strings.
- Do not wrap the JSON in markdown unless necessary; raw JSON preferred.
- Do not invent facts.`;

export function parseMemoryFlushPayload(content: string): MemoryFlushPayload | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const braced = trimmed.match(/\{[\s\S]*\}/);
  if (braced?.[0]) candidates.push(braced[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<MemoryFlushPayload>;
      if (!parsed?.l1 || typeof parsed.l1 !== "object") continue;
      const l1 = parsed.l1 as Record<string, unknown>;
      const required = ["Goal", "Decisions+Why", "Files touched", "Open questions", "Next"] as const;
      if (required.some((k) => typeof l1[k] !== "string")) continue;

      const facts = Array.isArray(parsed.facts)
        ? parsed.facts.filter(isFactDecision)
        : [];
      const pins = Array.isArray(parsed.pins)
        ? parsed.pins.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        : [];

      return {
        l1: {
          Goal: String(l1.Goal),
          "Decisions+Why": String(l1["Decisions+Why"]),
          "Files touched": String(l1["Files touched"]),
          "Open questions": String(l1["Open questions"]),
          Next: String(l1.Next),
          ...(typeof l1["Historical Context"] === "string"
            ? { "Historical Context": l1["Historical Context"] }
            : {}),
        },
        facts,
        pins,
      };
    } catch {
      // next candidate
    }
  }
  return null;
}

function isFactDecision(value: unknown): value is FactMergeDecision {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const action = v.action;
  if (action !== "ADD" && action !== "UPDATE" && action !== "DELETE" && action !== "NOOP") {
    return false;
  }
  if (typeof v.reason !== "string") return false;
  return true;
}
