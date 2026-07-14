import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CompactBoundary,
  FactMergeDecision,
  LLMRouter,
  MemorySystem,
  RecallOptions,
  RecallResult,
  SessionId,
  TranscriptMessage,
} from "@kako/shared";
import { getSessionMemoryDir } from "../config/paths.js";
import { appendCompactBoundary, consolidateToL1, summaryPath } from "./compact.js";
import { loadPins, savePins, upsertPin } from "./pins.js";
import type { MemoryPin } from "@kako/shared";

export class FileMemoryStore implements MemorySystem {
  constructor(private sessionId: SessionId) {}

  private get transcriptPath(): string {
    return join(getSessionMemoryDir(this.sessionId), "transcript.jsonl");
  }

  private get summaryPath(): string {
    return summaryPath(this.sessionId);
  }

  async append(message: TranscriptMessage): Promise<void> {
    await mkdir(getSessionMemoryDir(this.sessionId), { recursive: true });
    await appendFile(this.transcriptPath, `${JSON.stringify(message)}\n`, "utf-8");
  }

  async loadTranscript(): Promise<TranscriptMessage[]> {
    try {
      const text = await readFile(this.transcriptPath, "utf-8");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TranscriptMessage);
    } catch {
      return [];
    }
  }

  async rewriteTranscript(messages: TranscriptMessage[]): Promise<void> {
    await mkdir(getSessionMemoryDir(this.sessionId), { recursive: true });
    const body = messages.length
      ? `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`
      : "";
    await writeFile(this.transcriptPath, body, "utf-8");
  }

  async truncateTranscript(length: number): Promise<void> {
    const keep = Math.max(0, length);
    const transcript = await this.loadTranscript();
    if (transcript.length <= keep) return;
    await this.rewriteTranscript(transcript.slice(0, keep));
  }

  /**
   * Legacy recall — bounded substring match on current session only.
   * Prefer memory_search (FTS) for production retrieval; this never dumps unbounded L0.
   */
  async recall(options: RecallOptions): Promise<RecallResult[]> {
    const results: RecallResult[] = [];
    const limit = Math.min(options.limit ?? 8, 8);
    const maxSnippet = 700;
    if (options.layers.includes("L0")) {
      const transcript = await this.loadTranscript();
      const query = options.query.toLowerCase();
      for (const msg of transcript) {
        if (msg.role === "system") continue;
        if (msg.content.toLowerCase().includes(query)) {
          results.push({
            layer: "L0",
            content: msg.content.slice(0, maxSnippet),
            source: this.transcriptPath,
            score: 1,
          });
          if (results.length >= limit) break;
        }
      }
    }
    if (results.length < limit && options.layers.includes("L1")) {
      try {
        const summary = await readFile(this.summaryPath, "utf-8");
        results.push({
          layer: "L1",
          content: summary.slice(0, maxSnippet),
          source: this.summaryPath,
          score: 1,
        });
      } catch {
        // no summary yet
      }
    }
    return results.slice(0, limit);
  }

  async consolidate(
    sessionId: SessionId,
    options?: { router?: LLMRouter; model?: string },
  ): Promise<void> {
    const store = new FileMemoryStore(sessionId);
    const transcript = await store.loadTranscript();
    if (!transcript.length) return;
    await consolidateToL1({
      sessionId,
      transcript,
      router: options?.router,
      model: options?.model,
    });
  }

  async extractFacts(transcript: TranscriptMessage[] = []): Promise<FactMergeDecision[]> {
    const { extractFactsFromTranscript, applyFactDecisions } = await import("./facts.js");
    const decisions = await extractFactsFromTranscript(transcript);
    await applyFactDecisions(decisions);
    return decisions;
  }

  async loadPins(): Promise<MemoryPin[]> {
    return loadPins(this.sessionId);
  }

  async savePins(pins: MemoryPin[]): Promise<void> {
    return savePins(this.sessionId, pins);
  }

  async addPin(content: string, source?: string): Promise<MemoryPin[]> {
    return upsertPin(this.sessionId, content, source);
  }

  async appendBoundary(boundary: CompactBoundary): Promise<void> {
    await appendCompactBoundary(this.sessionId, boundary);
  }
}

export function createMessage(
  role: TranscriptMessage["role"],
  content: string,
  extra?: Partial<TranscriptMessage>,
): TranscriptMessage {
  return {
    id: `msg-${randomUUID().slice(0, 8)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

export function transcriptPreviewText(message: TranscriptMessage): string {
  if (message.content.trim()) return message.content;
  if (message.attachments?.length) {
    return `[${message.attachments.length} attachment(s)]`;
  }
  return message.content;
}

/** Transcript rows the user typed in the CLI chat box (↑/↓ history). */
export function isCliInputHistoryMessage(msg: TranscriptMessage): boolean {
  if (msg.role !== "user") return false;
  return msg.metadata?.cliInput === true;
}

export async function getTranscriptLength(sessionId: SessionId): Promise<number> {
  const store = new FileMemoryStore(sessionId);
  return (await store.loadTranscript()).length;
}

export async function truncateSessionTranscript(
  sessionId: SessionId,
  length: number,
): Promise<void> {
  const store = new FileMemoryStore(sessionId);
  await store.truncateTranscript(length);
}

/** User prompts from L0 transcript for CLI input history (↑/↓). */
export function sessionInputHistory(transcript: TranscriptMessage[]): string[] {
  const lines: string[] = [];
  for (const msg of transcript) {
    if (!isCliInputHistoryMessage(msg)) continue;
    const text = transcriptPreviewText(msg).trim();
    if (!text) continue;
    const last = lines[lines.length - 1];
    if (last === text) continue;
    lines.push(text);
  }
  return lines;
}
