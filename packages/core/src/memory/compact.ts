import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CompactBoundary,
  CompactionCascadeResult,
  CompactionTier,
  MemoryInjectCaps,
  PreCompactFlushResult,
  SessionId,
  TranscriptMessage,
} from "@kako/shared";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";
import type { LLMRouter } from "@kako/shared";
import { getSessionMemoryDir } from "../config/paths.js";
import { isProtocolWakeText } from "../background/agent-notification.js";
import {
  draftL1FromTranscript,
  formatL1Summary,
  L1_CONSOLIDATE_SYSTEM_PROMPT,
  L1_SECTION_HEADERS,
  mergeCumulativeL1,
  parseL1Summary,
  type L1SectionName,
  type L1SummaryDocument,
} from "./l1.js";
import { loadPins, selectPinsForInject } from "./pins.js";
import {
  estimateMessagesTokens,
  estimateTextTokens,
  resolveContextWindow,
  softCompactThreshold,
} from "./tokens.js";

export interface ProjectToolResultsOptions {
  caps?: MemoryInjectCaps;
  /** Keep the newest N tool results for a given file path at full fidelity. */
  keepFullReadsPerPath?: number;
}

/**
 * Tier A: project a transcript view with folded older tool results.
 * Does not mutate L0 on disk.
 */
export function projectToolResultsForContext(
  transcript: TranscriptMessage[],
  options: ProjectToolResultsOptions = {},
): TranscriptMessage[] {
  const caps = options.caps ?? DEFAULT_MEMORY_INJECT_CAPS;
  const keepFull = options.keepFullReadsPerPath ?? 1;
  const pathByCallId = collectToolCallPaths(transcript);

  // Walk newest → oldest so we keep recent full reads.
  const pathFullKept = new Map<string, number>();
  const foldFlags = new Array<boolean>(transcript.length).fill(false);

  for (let i = transcript.length - 1; i >= 0; i--) {
    const msg = transcript[i]!;
    if (msg.role !== "tool") continue;
    const pathKey =
      (typeof msg.metadata?.filePath === "string" && msg.metadata.filePath.trim()) ||
      (msg.toolCallId ? pathByCallId.get(msg.toolCallId) : undefined) ||
      null;

    if (msg.content.length <= caps.toolResultMaxChars) {
      if (pathKey) {
        const kept = pathFullKept.get(pathKey) ?? 0;
        if (kept < keepFull) {
          pathFullKept.set(pathKey, kept + 1);
          continue;
        }
        foldFlags[i] = true;
        continue;
      }
      continue;
    }
    foldFlags[i] = true;
  }

  return transcript.map((msg, i) => {
    if (!foldFlags[i] || msg.role !== "tool") return msg;
    return {
      ...msg,
      content: foldToolResultContent(msg, caps),
      metadata: { ...msg.metadata, toolResultFolded: true },
    };
  });
}

function collectToolCallPaths(transcript: TranscriptMessage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of transcript) {
    if (msg.role !== "assistant" || !msg.toolCalls?.length) continue;
    for (const tc of msg.toolCalls) {
      const input = tc.input as Record<string, unknown> | undefined;
      if (!input || typeof input !== "object") continue;
      const p = String(input.file_path ?? input.path ?? "").trim();
      if (p) map.set(tc.id, p);
    }
  }
  return map;
}

export function foldToolResultContent(
  msg: TranscriptMessage,
  caps: MemoryInjectCaps = DEFAULT_MEMORY_INJECT_CAPS,
): string {
  const lines = msg.content.split("\n");
  const tail = lines.slice(-caps.toolResultKeepTailLines).join("\n");
  const name = msg.toolName ?? "tool";
  const omitted = Math.max(0, lines.length - caps.toolResultKeepTailLines);
  return [
    `[folded tool result: ${name}; ${msg.content.length} chars; omitted ${omitted} earlier lines]`,
    `… truncated; re-Read with offset/limit if full content is needed.`,
    tail,
  ].join("\n");
}

export function compactionPath(sessionId: SessionId): string {
  return join(getSessionMemoryDir(sessionId), "compaction.jsonl");
}

export function summaryPath(sessionId: SessionId): string {
  return join(getSessionMemoryDir(sessionId), "summary.md");
}

export async function appendCompactBoundary(
  sessionId: SessionId,
  boundary: CompactBoundary,
): Promise<void> {
  await mkdir(getSessionMemoryDir(sessionId), { recursive: true });
  await appendFile(compactionPath(sessionId), `${JSON.stringify(boundary)}\n`, "utf-8");
}

export async function loadL1Document(sessionId: SessionId): Promise<L1SummaryDocument | null> {
  try {
    const text = await readFile(summaryPath(sessionId), "utf-8");
    return parseL1Summary(text, sessionId);
  } catch {
    return null;
  }
}

export async function writeL1Document(sessionId: SessionId, doc: L1SummaryDocument): Promise<void> {
  await mkdir(getSessionMemoryDir(sessionId), { recursive: true });
  await writeFile(summaryPath(sessionId), formatL1Summary(doc), "utf-8");
}

export interface ConsolidateOptions {
  sessionId: SessionId;
  transcript: TranscriptMessage[];
  router?: LLMRouter;
  model?: string;
  /** Prefer LLM when provided; always falls back to structured draft. */
  forceGeneration?: number;
}

export async function consolidateToL1(options: ConsolidateOptions): Promise<L1SummaryDocument> {
  const { sessionId, transcript, router, model } = options;
  const previous = await loadL1Document(sessionId);
  const nextGen =
    options.forceGeneration ?? (previous ? previous.frontmatter.compactGeneration + 1 : 1);

  let draft: Partial<Record<L1SectionName, string>> = draftL1FromTranscript(transcript);

  if (router && model && transcript.length > 0) {
    try {
      const llmDraft = await llmConsolidateDraft(router, model, transcript, previous);
      if (llmDraft) draft = llmDraft;
    } catch {
      // Keep deterministic draft on LLM failure.
    }
  }

  const merged = mergeCumulativeL1(previous, draft, sessionId, nextGen);
  await writeL1Document(sessionId, merged);
  return merged;
}

async function llmConsolidateDraft(
  router: LLMRouter,
  model: string,
  transcript: TranscriptMessage[],
  previous: L1SummaryDocument | null,
): Promise<Partial<Record<L1SectionName, string>> | null> {
  const slice = transcript.slice(-80);
  const transcriptText = slice
    .filter((m) => !isProtocolWakeText(m.content))
    .map((m) => `${m.role}${m.toolName ? `(${m.toolName})` : ""}: ${m.content.slice(0, 800)}`)
    .join("\n");
  const prevText = previous ? formatL1Summary(previous) : "(none)";
  const completion = await router.complete({
    model,
    messages: [
      { role: "system", content: L1_CONSOLIDATE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Previous summary:\n${prevText}\n\nTranscript slice:\n${transcriptText}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 2048,
  });
  return parseStructuredSections(completion.content);
}

function parseStructuredSections(content: string): Partial<Record<L1SectionName, string>> | null {
  const sections: Partial<Record<L1SectionName, string>> = {};
  let current: L1SectionName | null = null;
  const buffers: Partial<Record<L1SectionName, string[]>> = {};
  for (const line of content.split("\n")) {
    const heading = line.match(/^##\s+(.+)\s*$/);
    if (heading) {
      const raw = heading[1]!.trim();
      const match = L1_SECTION_HEADERS.find((h) => h.toLowerCase() === raw.toLowerCase());
      current = match ?? null;
      if (current) buffers[current] = [];
      continue;
    }
    if (current) (buffers[current] ??= []).push(line);
  }
  for (const name of L1_SECTION_HEADERS) {
    const body = (buffers[name] ?? []).join("\n").trim();
    if (body) sections[name] = body;
  }
  return Object.keys(sections).length ? sections : null;
}

export interface FlushOptions {
  sessionId: SessionId;
  transcript: TranscriptMessage[];
  sandboxReadOnly?: boolean;
  alreadyFlushedThisCycle?: boolean;
  router?: LLMRouter;
  model?: string;
}

/**
 * Write-before-compact: persist durable session state once per compaction cycle.
 * Prefer structured JSON flush (tool-less); fall back to deterministic L1 draft.
 */
export async function preCompactFlush(options: FlushOptions): Promise<PreCompactFlushResult> {
  if (options.sandboxReadOnly) {
    return { flushed: false, skippedReason: "sandbox_readonly" };
  }
  if (options.alreadyFlushedThisCycle) {
    return { flushed: false, skippedReason: "already_flushed" };
  }

  let wroteL3 = false;
  let structuredOk = false;

  if (options.router && options.model) {
    try {
      const { FLUSH_SYSTEM_PROMPT, parseMemoryFlushPayload } = await import("./flush-schema.js");
      const slice = options.transcript.slice(-80);
      const transcriptText = slice
        .map((m) => `${m.role}${m.toolName ? `(${m.toolName})` : ""}: ${m.content.slice(0, 600)}`)
        .join("\n");
      const completion = await options.router.complete({
        model: options.model,
        messages: [
          { role: "system", content: FLUSH_SYSTEM_PROMPT },
          { role: "user", content: `Transcript:\n${transcriptText}` },
        ],
        temperature: 0.2,
        maxTokens: 2048,
      });
      const payload = parseMemoryFlushPayload(completion.content);
      if (payload) {
        const previous = await loadL1Document(options.sessionId);
        const nextGen = previous ? previous.frontmatter.compactGeneration + 1 : 1;
        const merged = mergeCumulativeL1(previous, payload.l1, options.sessionId, nextGen);
        await writeL1Document(options.sessionId, merged);
        const { applyFactDecisions } = await import("./facts.js");
        await applyFactDecisions(payload.facts);
        wroteL3 = payload.facts.some((d) => d.action === "ADD" || d.action === "UPDATE");
        const { upsertPin } = await import("./pins.js");
        for (const pin of payload.pins) {
          await upsertPin(options.sessionId, pin, "flush");
        }
        structuredOk = true;
      }
    } catch {
      structuredOk = false;
    }
  }

  if (!structuredOk) {
    await consolidateToL1({
      sessionId: options.sessionId,
      transcript: options.transcript,
      router: options.router,
      model: options.model,
    });
    try {
      const { extractFactsFromTranscript, applyFactDecisions } = await import("./facts.js");
      const decisions = await extractFactsFromTranscript(options.transcript);
      await applyFactDecisions(decisions);
      wroteL3 = decisions.some((d) => d.action === "ADD" || d.action === "UPDATE");
    } catch {
      /* best-effort */
    }
  }

  let wroteDaily = false;
  try {
    const { consolidateL1ToL2, todayDateKey } = await import("./l2.js");
    await consolidateL1ToL2({
      dateKey: todayDateKey(),
      sessionIds: [options.sessionId],
    });
    wroteDaily = true;
  } catch {
    /* best-effort */
  }

  try {
    const { syncSessionToFts } = await import("./index-fts.js");
    await syncSessionToFts(options.sessionId);
  } catch {
    /* best-effort */
  }

  return {
    flushed: true,
    wroteL1: true,
    wroteL3,
    wroteDaily,
  };
}

export interface CascadeOptions {
  sessionId: SessionId;
  transcript: TranscriptMessage[];
  contextWindow?: number;
  caps?: MemoryInjectCaps;
  sandboxReadOnly?: boolean;
  alreadyFlushedThisCycle?: boolean;
  /** Session compact cycle meta (flush-once per generation). */
  memoryCompact?: import("@kako/shared").SessionMemoryCompact;
  /** Calibrated estimate ratio from usage EMA. */
  tokenEstimateRatio?: number;
  router?: LLMRouter;
  model?: string;
  /** When true, skip Tier C LLM even if over budget (still applies A/B). */
  skipFullConsolidate?: boolean;
}

export interface CascadeView {
  result: CompactionCascadeResult;
  /** Transcript view for buildMessages (never mutates L0 file). */
  viewTranscript: TranscriptMessage[];
  sessionSummary?: string;
  /** Updated cycle meta for the caller to persist. */
  memoryCompact?: import("@kako/shared").SessionMemoryCompact;
}

/**
 * Compaction cascade: Tier A always; B/C when over soft token threshold.
 */
export async function runCompactionCascade(options: CascadeOptions): Promise<CascadeView> {
  const caps = options.caps ?? DEFAULT_MEMORY_INJECT_CAPS;
  const contextWindow = resolveContextWindow(options.contextWindow);
  const threshold = softCompactThreshold(contextWindow, caps);

  const tierA = projectToolResultsForContext(options.transcript, { caps });
  const tokensBeforeRaw = estimateMessagesTokens(tierA);
  const { applyEstimateRatio } = await import("./tokens.js");
  const tokensBefore = applyEstimateRatio(tokensBeforeRaw, options.tokenEstimateRatio);

  let viewTranscript = tierA;
  let tierApplied: CompactionTier | null = "A";
  let flush: PreCompactFlushResult | null = null;
  let compactGeneration: number | undefined;
  let boundary: CompactBoundary | undefined;
  let sessionSummary: string | undefined;
  let lastFailure: { at: string; message: string } | undefined =
    options.memoryCompact?.lastFailure;

  const existing = await loadL1Document(options.sessionId);
  if (existing) {
    sessionSummary = formatL1Summary(existing);
  }

  const currentGen =
    options.memoryCompact?.generation ?? existing?.frontmatter.compactGeneration ?? 0;
  const alreadyFlushed =
    options.alreadyFlushedThisCycle === true ||
    (Boolean(options.memoryCompact?.lastFlushAt) &&
      (options.memoryCompact?.generation ?? 0) === currentGen &&
      currentGen > 0);

  if (tokensBefore < threshold) {
    return {
      result: {
        tierApplied: "A",
        flush: null,
        estimatedTokensBefore: tokensBefore,
        estimatedTokensAfter: tokensBefore,
      },
      viewTranscript,
      sessionSummary,
      memoryCompact: options.memoryCompact,
    };
  }

  try {
    flush = await preCompactFlush({
      sessionId: options.sessionId,
      transcript: options.transcript,
      sandboxReadOnly: options.sandboxReadOnly,
      alreadyFlushedThisCycle: alreadyFlushed,
      router: options.router,
      model: options.model,
    });
  } catch (err) {
    lastFailure = {
      at: new Date().toISOString(),
      message: err instanceof Error ? err.message : String(err),
    };
    flush = { flushed: false, skippedReason: "already_flushed" };
  }

  const l1AfterFlush = await loadL1Document(options.sessionId);
  if (l1AfterFlush) {
    sessionSummary = formatL1Summary(l1AfterFlush);
    compactGeneration = l1AfterFlush.frontmatter.compactGeneration;
  }

  // Tier B: replace older messages with summary + recent tail (+ pins stay in bootstrap).
  const tailCount = Math.max(1, caps.recentTailTurns * 2);
  const tail = tierA.slice(-tailCount);
  viewTranscript = tail;
  tierApplied = "B";

  let tokensAfter =
    applyEstimateRatio(
      estimateMessagesTokens(viewTranscript) + estimateTextTokens(sessionSummary ?? ""),
      options.tokenEstimateRatio,
    );

  if (tokensAfter >= threshold && !options.skipFullConsolidate) {
    try {
      const doc = await consolidateToL1({
        sessionId: options.sessionId,
        transcript: options.transcript,
        router: options.router,
        model: options.model,
      });
      sessionSummary = formatL1Summary(doc);
      compactGeneration = doc.frontmatter.compactGeneration;
      viewTranscript = tierA.slice(-Math.max(2, caps.recentTailTurns));
      tierApplied = "C";
      tokensAfter = applyEstimateRatio(
        estimateMessagesTokens(viewTranscript) + estimateTextTokens(sessionSummary),
        options.tokenEstimateRatio,
      );
    } catch (err) {
      lastFailure = {
        at: new Date().toISOString(),
        message: err instanceof Error ? err.message : String(err),
      };
      // Keep prior L1 / view Tier B.
    }
  }

  if (compactGeneration !== undefined) {
    boundary = {
      type: "compact_boundary",
      timestamp: new Date().toISOString(),
      sessionId: options.sessionId,
      compactGeneration,
      tier: tierApplied,
      retainedTailCount: viewTranscript.length,
      summaryPath: summaryPath(options.sessionId),
    };
    await appendCompactBoundary(options.sessionId, boundary);
  }

  const pins = selectPinsForInject(await loadPins(options.sessionId), caps);
  tokensAfter += estimateTextTokens(pins.map((p) => p.content).join("\n"));

  const flushedNow = flush?.flushed === true;
  const memoryCompact: import("@kako/shared").SessionMemoryCompact = {
    generation: compactGeneration ?? currentGen,
    lastFlushAt: flushedNow
      ? new Date().toISOString()
      : options.memoryCompact?.lastFlushAt,
    lastCompactAt:
      tierApplied === "B" || tierApplied === "C"
        ? new Date().toISOString()
        : options.memoryCompact?.lastCompactAt,
    lastTier: tierApplied ?? undefined,
    tokenEstimateRatio: options.tokenEstimateRatio,
    ...(lastFailure ? { lastFailure } : {}),
  };

  return {
    result: {
      tierApplied,
      flush,
      estimatedTokensBefore: tokensBefore,
      estimatedTokensAfter: tokensAfter,
      compactGeneration,
      boundary,
    },
    viewTranscript,
    sessionSummary,
    memoryCompact,
  };
}
