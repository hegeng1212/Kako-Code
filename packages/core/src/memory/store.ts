import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemorySystem, RecallOptions, RecallResult, SessionId, TranscriptMessage } from "@kako/shared";
import type { FactMergeDecision } from "@kako/shared";
import { getSessionMemoryDir } from "../config/paths.js";

export class FileMemoryStore implements MemorySystem {
  constructor(private sessionId: SessionId) {}

  private get transcriptPath(): string {
    return join(getSessionMemoryDir(this.sessionId), "transcript.jsonl");
  }

  private get summaryPath(): string {
    return join(getSessionMemoryDir(this.sessionId), "summary.md");
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

  async recall(options: RecallOptions): Promise<RecallResult[]> {
    const results: RecallResult[] = [];
    if (options.layers.includes("L0")) {
      const transcript = await this.loadTranscript();
      const query = options.query.toLowerCase();
      for (const msg of transcript) {
        if (msg.content.toLowerCase().includes(query)) {
          results.push({
            layer: "L0",
            content: msg.content,
            source: this.transcriptPath,
          });
        }
      }
    }
    if (options.layers.includes("L1")) {
      try {
        const summary = await readFile(this.summaryPath, "utf-8");
        results.push({ layer: "L1", content: summary, source: this.summaryPath });
      } catch {
        // no summary yet
      }
    }
    return results.slice(0, options.limit ?? 10);
  }

  async consolidate(sessionId: SessionId): Promise<void> {
    const store = new FileMemoryStore(sessionId);
    const transcript = await store.loadTranscript();
    if (!transcript.length) return;

    const lines = transcript.map((m) => `**${m.role}**: ${m.content.slice(0, 500)}`);
    const summary = [
      `# Session Summary`,
      ``,
      `Session: ${sessionId}`,
      `Messages: ${transcript.length}`,
      ``,
      ...lines,
    ].join("\n");

    await mkdir(getSessionMemoryDir(sessionId), { recursive: true });
    await writeFile(store.summaryPath, summary, "utf-8");
  }

  async extractFacts(): Promise<FactMergeDecision[]> {
    return [];
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
