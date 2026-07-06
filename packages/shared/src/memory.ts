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

/** Options for memory recall queries. */
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

/** Core memory system interface (implementation in @kako/core). */
export interface MemorySystem {
  append(message: TranscriptMessage): Promise<void>;
  recall(options: RecallOptions): Promise<RecallResult[]>;
  consolidate(sessionId: SessionId): Promise<void>;
  extractFacts(transcript: TranscriptMessage[]): Promise<FactMergeDecision[]>;
}
