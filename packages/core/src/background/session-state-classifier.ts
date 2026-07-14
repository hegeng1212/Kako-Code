import type { LLMMessage, LLMRouter } from "@kako/shared";
import type { SessionAgentState } from "@kako/shared";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../agents/prompts/session-state-classifier.md",
);

let cachedSystemPrompt: string | null = null;

async function loadClassifierSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  cachedSystemPrompt = await readFile(PROMPT_PATH, "utf-8");
  return cachedSystemPrompt;
}

export interface SessionStateClassifierInput {
  previousState?: SessionAgentState;
  userAsk: string;
  assistantTail: string;
  toolSummary: string;
}

export interface SessionStateClassifierResult {
  state: SessionAgentState["state"];
  detail: string;
  tempo: SessionAgentState["tempo"];
  needs?: string;
  result?: string;
}

export function buildClassifierUserMessage(input: SessionStateClassifierInput): string {
  const prev = input.previousState;
  const prevLine = prev
    ? `Current state: ${prev.state} (since ${prev.since})`
    : "Current state: (none)";
  return [
    prevLine,
    `Tool calls so far: ${input.toolSummary || "none"}`,
    `User's most recent ask: "${input.userAsk.trim()}"`,
    `Assistant message tail (last ~1000 chars):\n${input.assistantTail.trim().slice(-1000)}`,
  ].join("\n\n");
}

export function parseClassifierResponse(content: string): SessionStateClassifierResult | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const braced = trimmed.match(/\{[\s\S]*\}/);
  if (braced?.[0]) candidates.push(braced[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        state?: unknown;
        detail?: unknown;
        tempo?: unknown;
        needs?: unknown;
        output?: { result?: unknown };
      };
      const state = parsed.state;
      if (
        state !== "done" &&
        state !== "working" &&
        state !== "blocked" &&
        state !== "failed"
      ) {
        continue;
      }
      const detail = typeof parsed.detail === "string" ? parsed.detail.trim().slice(0, 64) : "";
      if (!detail) continue;
      const tempo = parsed.tempo;
      const normalizedTempo =
        tempo === "active" || tempo === "idle" || tempo === "blocked" ? tempo : "active";
      const needs = typeof parsed.needs === "string" ? parsed.needs.trim() : undefined;
      const result =
        typeof parsed.output?.result === "string" ? parsed.output.result.trim() : undefined;
      return { state, detail, tempo: normalizedTempo, needs, result };
    } catch {
      // try next
    }
  }
  return null;
}

export async function classifySessionState(
  router: LLMRouter,
  model: string,
  input: SessionStateClassifierInput,
): Promise<SessionStateClassifierResult | null> {
  const system = await loadClassifierSystemPrompt();
  const messages: LLMMessage[] = [
    { role: "system", content: system },
    { role: "user", content: buildClassifierUserMessage(input) },
  ];
  const completion = await router.complete({
    model,
    messages,
    temperature: 0,
    maxTokens: 256,
  });
  return parseClassifierResponse(completion.content);
}

export function summarizeToolCallsFromTranscript(
  toolNames: string[],
): string {
  if (!toolNames.length) return "";
  const counts = new Map<string, number>();
  for (const name of toolNames) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => (count > 1 ? `${name}×${count}` : name))
    .join(", ");
}
