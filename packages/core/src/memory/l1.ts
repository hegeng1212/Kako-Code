import type { L1SummaryFrontmatter, SessionId, TranscriptMessage } from "@kako/shared";
import { isProtocolWakeText } from "../background/agent-notification.js";

export const L1_SECTION_HEADERS = [
  "Goal",
  "Decisions+Why",
  "Files touched",
  "Open questions",
  "Next",
  "Historical Context",
] as const;

export type L1SectionName = (typeof L1_SECTION_HEADERS)[number];

export interface L1SummaryDocument {
  frontmatter: L1SummaryFrontmatter;
  sections: Record<L1SectionName, string>;
  rawBody: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseL1Frontmatter(yaml: string): Partial<L1SummaryFrontmatter> {
  const out: Partial<L1SummaryFrontmatter> = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!key || value === undefined) continue;
    const v = value.trim().replace(/^["']|["']$/g, "");
    if (key === "updatedAt") out.updatedAt = v;
    if (key === "compactGeneration") {
      const n = Number(v);
      if (Number.isFinite(n)) out.compactGeneration = n;
    }
    if (key === "sessionId") out.sessionId = v as SessionId;
  }
  return out;
}

export function parseL1Summary(
  text: string,
  fallbackSessionId: SessionId,
): L1SummaryDocument {
  let body = text;
  let frontmatter: L1SummaryFrontmatter = {
    updatedAt: new Date().toISOString(),
    compactGeneration: 0,
    sessionId: fallbackSessionId,
  };

  const fm = text.match(FRONTMATTER_RE);
  if (fm) {
    const parsed = parseL1Frontmatter(fm[1]!);
    frontmatter = {
      updatedAt: parsed.updatedAt ?? frontmatter.updatedAt,
      compactGeneration: parsed.compactGeneration ?? 0,
      sessionId: parsed.sessionId ?? fallbackSessionId,
    };
    body = fm[2] ?? "";
  }

  const sections = emptySections();
  let current: L1SectionName | null = null;
  const buffers: Partial<Record<L1SectionName, string[]>> = {};

  for (const line of body.split("\n")) {
    const heading = line.match(/^##\s+(.+)\s*$/);
    if (heading) {
      const name = normalizeSectionName(heading[1]!);
      current = name;
      if (name && !buffers[name]) buffers[name] = [];
      continue;
    }
    if (current) {
      (buffers[current] ??= []).push(line);
    }
  }

  for (const name of L1_SECTION_HEADERS) {
    sections[name] = (buffers[name] ?? []).join("\n").trim();
  }

  return { frontmatter, sections, rawBody: body.trim() };
}

function normalizeSectionName(raw: string): L1SectionName | null {
  const t = raw.trim();
  for (const h of L1_SECTION_HEADERS) {
    if (h.toLowerCase() === t.toLowerCase()) return h;
  }
  if (/^decisions/i.test(t)) return "Decisions+Why";
  if (/^files/i.test(t)) return "Files touched";
  if (/^open/i.test(t)) return "Open questions";
  if (/^historical/i.test(t)) return "Historical Context";
  if (/^goal/i.test(t)) return "Goal";
  if (/^next/i.test(t)) return "Next";
  return null;
}

function emptySections(): Record<L1SectionName, string> {
  return {
    Goal: "",
    "Decisions+Why": "",
    "Files touched": "",
    "Open questions": "",
    Next: "",
    "Historical Context": "",
  };
}

export function formatL1Summary(doc: L1SummaryDocument): string {
  const { frontmatter, sections } = doc;
  const fm = [
    "---",
    `updatedAt: ${frontmatter.updatedAt}`,
    `compactGeneration: ${frontmatter.compactGeneration}`,
    `sessionId: ${frontmatter.sessionId}`,
    "---",
    "",
    `# Session Summary`,
    "",
  ];
  const body: string[] = [];
  for (const name of L1_SECTION_HEADERS) {
    body.push(`## ${name}`, "", sections[name] || "(none)", "");
  }
  return [...fm, ...body].join("\n").trimEnd() + "\n";
}

/**
 * Build cumulative L1: keep prior points under Historical Context,
 * refresh working sections from the provided structured draft.
 */
export function mergeCumulativeL1(
  previous: L1SummaryDocument | null,
  draft: Partial<Record<L1SectionName, string>>,
  sessionId: SessionId,
  nextGeneration: number,
): L1SummaryDocument {
  const sections = emptySections();
  for (const name of L1_SECTION_HEADERS) {
    if (name === "Historical Context") continue;
    sections[name] = (draft[name] ?? "").trim() || previous?.sections[name] || "(none)";
  }

  const priorBits: string[] = [];
  if (previous) {
    const gen = previous.frontmatter.compactGeneration;
    const snapshot = L1_SECTION_HEADERS.filter((n) => n !== "Historical Context")
      .map((n) => `${n}: ${previous.sections[n] || "(none)"}`)
      .join(" | ");
    priorBits.push(`Compact gen ${gen}: ${snapshot}`);
    if (previous.sections["Historical Context"]) {
      priorBits.push(previous.sections["Historical Context"]);
    }
  }
  if (draft["Historical Context"]?.trim()) {
    priorBits.unshift(draft["Historical Context"].trim());
  }
  sections["Historical Context"] = priorBits.join("\n\n") || "(none)";

  return {
    frontmatter: {
      updatedAt: new Date().toISOString(),
      compactGeneration: nextGeneration,
      sessionId,
    },
    sections,
    rawBody: "",
  };
}

/** Deterministic structured draft from transcript when no LLM is available. */
export function draftL1FromTranscript(
  transcript: TranscriptMessage[],
): Partial<Record<L1SectionName, string>> {
  const users = transcript
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter((t) => t && !isProtocolWakeText(t));
  const assistants = transcript
    .filter((m) => m.role === "assistant")
    .map((m) => m.content.trim())
    .filter((t) => t && !isProtocolWakeText(t));
  const toolNames = [
    ...new Set(
      transcript.filter((m) => m.role === "tool" && m.toolName).map((m) => m.toolName!),
    ),
  ];

  return {
    Goal: users[0]?.slice(0, 500) || "(none)",
    "Decisions+Why": assistants.slice(-3).map((a) => a.slice(0, 300)).join("\n") || "(none)",
    "Files touched": toolNames.length
      ? `Tools used: ${toolNames.join(", ")}`
      : "(none)",
    "Open questions": "(none)",
    Next: users.at(-1)?.slice(0, 400) || "(none)",
  };
}

export const L1_CONSOLIDATE_SYSTEM_PROMPT = `You compress a coding-agent session into a cumulative structured summary.
Write markdown with exactly these ## sections (in order): Goal, Decisions+Why, Files touched, Open questions, Next, Historical Context.
Rules:
- Preserve prior decisions under Historical Context when a previous summary is provided.
- Prefer concrete paths, identifiers, and open work items.
- Do not invent facts not present in the transcript or previous summary.
- Keep each section concise (a few bullets or short paragraphs).`;
