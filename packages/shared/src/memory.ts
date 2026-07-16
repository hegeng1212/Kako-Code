import type { SessionId } from "./agent.js";
import type { UserAttachment } from "./attachment.js";
import type { ToolCall } from "./tool.js";

/** Memory layer identifiers (L0–L5). */
export type MemoryLayer =
  | "L0"
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5";

export const MEMORY_LAYER_LABELS: Record<MemoryLayer, string> = {
  L0: "Raw Transcript",
  L1: "Session Summary",
  L2: "Rolling Summary",
  L3: "Long-term Facts",
  L4: "User Profile",
  L5: "Episodic Archive",
};

/** Compaction cascade tier (budget → session-memory → full LLM). */
export type CompactionTier = "A" | "B" | "C";

/** A single message in the L0 transcript. */
export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  toolCallId?: string;
  toolName?: string;
  /** Tool calls issued by the assistant (required before tool result messages in LLM history). */
  toolCalls?: ToolCall[];
  metadata?: Record<string, unknown>;
  /** Files attached to a user message (images, PDF, Office). */
  attachments?: UserAttachment[];
}

/**
 * Appended to L0 (or compaction.jsonl) when a compact runs.
 * Never rewrites prior transcript lines — archive stays grep-able.
 */
export interface CompactBoundary {
  type: "compact_boundary";
  timestamp: string;
  sessionId: SessionId;
  compactGeneration: number;
  tier: CompactionTier;
  retainedTailCount: number;
  summaryPath?: string;
}

/** Verbatim reinject items (paths, numbers, open TODOs) with hard caps. */
export interface MemoryPin {
  id: string;
  content: string;
  createdAt: string;
  source?: string;
}

/** Bounded search hit — never dump full L0 into system. */
export interface SearchHit {
  layer: MemoryLayer;
  path: string;
  score: number;
  /** Snippet capped by inject caps (default ≤700 chars). */
  snippet: string;
  lineRange?: { start: number; end: number };
  sessionId?: SessionId;
}

/** L1 summary.md YAML frontmatter. */
export interface L1SummaryFrontmatter {
  updatedAt: string;
  compactGeneration: number;
  sessionId: SessionId;
}

/**
 * Hard caps for inject / search / tool-result projection.
 * Triggers are token/budget contracts — not semantic guards.
 */
export interface MemoryInjectCaps {
  /** Max pin entries reinjected per turn. */
  pinsMaxCount: number;
  /** Max total bytes of pin content reinjected. */
  pinsMaxBytes: number;
  /** Max estimated tokens for L3 fact excerpts at bootstrap. */
  l3FactsMaxTokens: number;
  /** Max auto-recall snippets injected per user message. */
  autoRecallMaxSnippets: number;
  /** Max estimated tokens for auto-recall block. */
  autoRecallMaxTokens: number;
  /** Max chars per search/auto-recall snippet. */
  searchHitSnippetChars: number;
  /** Default memory_search hit limit. */
  searchDefaultLimit: number;
  /** Fold older tool results above this char length (Tier A). */
  toolResultMaxChars: number;
  /** Tail lines kept when folding a tool result. */
  toolResultKeepTailLines: number;
  /** Context window reserve before soft compact threshold. */
  compactReserveTokens: number;
  /** Soft threshold as fraction of (contextWindow - reserve). */
  softCompactRatio: number;
  /** Recent turns kept verbatim after compact. */
  recentTailTurns: number;
}

export const DEFAULT_MEMORY_INJECT_CAPS: MemoryInjectCaps = {
  pinsMaxCount: 12,
  pinsMaxBytes: 4_096,
  l3FactsMaxTokens: 800,
  autoRecallMaxSnippets: 4,
  autoRecallMaxTokens: 600,
  searchHitSnippetChars: 700,
  searchDefaultLimit: 8,
  toolResultMaxChars: 4_000,
  toolResultKeepTailLines: 40,
  compactReserveTokens: 8_192,
  softCompactRatio: 0.8,
  recentTailTurns: 6,
};

/** Options for memory_search / FTS. */
export interface MemorySearchOptions {
  query: string;
  layers?: MemoryLayer[];
  limit?: number;
  sessionId?: SessionId;
  /** Workspace/user scope; omit sessionId for cross-session. */
  crossSession?: boolean;
}

/** Options for memory_get. */
export interface MemoryGetOptions {
  path: string;
  startLine?: number;
  endLine?: number;
  maxChars?: number;
}

/** Atomic fact stored in L3 with provenance. */
export interface MemoryFact {
  id: string;
  content: string;
  confidence: number;
  source: string;
  validFrom?: string;
  validTo?: string;
  createdAt: string;
  updatedAt: string;
}

/** mem0-style fact merge decision. */
export type FactMergeAction = "ADD" | "UPDATE" | "DELETE" | "NOOP";

export interface FactMergeDecision {
  action: FactMergeAction;
  factId?: string;
  content?: string;
  confidence?: number;
  reason: string;
}

/** Options for memory recall queries (legacy; prefer MemorySearchOptions). */
export interface RecallOptions {
  query: string;
  layers: MemoryLayer[];
  limit?: number;
  sessionId?: SessionId;
}

/** Result chunk returned from memory recall. */
export interface RecallResult {
  layer: MemoryLayer;
  content: string;
  source: string;
  score?: number;
}

/** Pre-compact flush outcome (write-before-compact). */
export interface PreCompactFlushResult {
  flushed: boolean;
  skippedReason?: "sandbox_readonly" | "already_flushed" | "below_threshold";
  wroteL1?: boolean;
  wroteL3?: boolean;
  wroteDaily?: boolean;
}

/** Result of running the compaction cascade for a turn. */
export interface CompactionCascadeResult {
  tierApplied: CompactionTier | null;
  flush: PreCompactFlushResult | null;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  compactGeneration?: number;
  boundary?: CompactBoundary;
}

/** Structured flush output (L1 sections + fact merge decisions + pin lines). */
export interface MemoryFlushPayload {
  l1: {
    Goal: string;
    "Decisions+Why": string;
    "Files touched": string;
    "Open questions": string;
    Next: string;
    "Historical Context"?: string;
  };
  facts: FactMergeDecision[];
  pins: string[];
}

/** Per-turn memory telemetry surfaced to runtime / UI. */
export interface MemoryTelemetry {
  tierApplied: CompactionTier | null;
  estimatedTokensBefore?: number;
  estimatedTokensAfter?: number;
  injectedSnippets?: number;
  injectedTokens?: number;
  flushed?: boolean;
  autoRecallEnabled?: boolean;
  backgroundReviewRan?: boolean;
  skippedReason?: string;
  jobName?: string;
}

/** Core memory system interface (implementation in @kako/core). */
export interface MemorySystem {
  append(message: TranscriptMessage): Promise<void>;
  recall(options: RecallOptions): Promise<RecallResult[]>;
  consolidate(sessionId: SessionId): Promise<void>;
  extractFacts(transcript: TranscriptMessage[]): Promise<FactMergeDecision[]>;
}
