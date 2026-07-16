import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { TranscriptMessage } from "@kako/shared";
import { applyStringReplace, parseEditInput } from "../tools/builtin/edit.js";
import { parseWriteInput } from "../tools/builtin/write.js";

export const CODE_MUTATING_TOOL_NAMES = new Set(["Write", "Edit", "NotebookEdit"]);

export function isCodeMutatingTool(name: string): boolean {
  return CODE_MUTATING_TOOL_NAMES.has(name);
}

export interface RewindCodeChangeSummary {
  count: number;
  additions: number;
  deletions: number;
  /** Basename of the first touched file (for confirm effect copy). */
  primaryFile?: string;
}

interface MutatingOp {
  name: string;
  input: Record<string, unknown>;
  resultText: string;
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function toolFilePath(name: string, input: Record<string, unknown>): string | undefined {
  if (name === "NotebookEdit") {
    const p = String(input.notebook_path ?? "").trim();
    return p || undefined;
  }
  const p = String(input.file_path ?? input.path ?? "").trim();
  return p || undefined;
}

function isToolError(content: string): boolean {
  return content.trimStart().toLowerCase().startsWith("error:");
}

/**
 * Collect successful Write/Edit/NotebookEdit ops in transcript order.
 * `endExclusive` defaults to transcript length (all later turns).
 */
export function collectMutatingOps(
  transcript: TranscriptMessage[],
  fromUserIndex: number,
  endExclusive = transcript.length,
): MutatingOp[] {
  const ops: MutatingOp[] = [];
  const pending = new Map<string, { name: string; input: Record<string, unknown> }>();
  const start = Math.max(0, fromUserIndex + 1);
  const end = Math.min(transcript.length, endExclusive);
  for (let i = start; i < end; i++) {
    const msg = transcript[i]!;
    if (msg.role === "assistant" && msg.toolCalls?.length) {
      for (const tc of msg.toolCalls) {
        if (!isCodeMutatingTool(tc.name)) continue;
        pending.set(tc.id, { name: tc.name, input: tc.input ?? {} });
      }
      continue;
    }
    if (msg.role === "tool" && msg.toolCallId) {
      const p = pending.get(msg.toolCallId);
      if (!p) continue;
      pending.delete(msg.toolCallId);
      if (!isToolError(msg.content)) {
        ops.push({ name: p.name, input: p.input, resultText: msg.content });
      }
    }
  }
  return ops;
}

export function summarizeCodeChanges(
  transcript: TranscriptMessage[],
  fromUserIndex: number,
  endExclusive?: number,
): RewindCodeChangeSummary | null {
  const ops = collectMutatingOps(transcript, fromUserIndex, endExclusive);
  if (ops.length === 0) return null;

  const files = new Map<string, { additions: number; deletions: number }>();
  for (const op of ops) {
    const path = toolFilePath(op.name, op.input);
    if (!path) continue;
    const cur = files.get(path) ?? { additions: 0, deletions: 0 };
    if (op.name === "Edit") {
      try {
        const parsed = parseEditInput(op.input);
        cur.additions += lineCount(parsed.newString);
        cur.deletions += lineCount(parsed.oldString);
      } catch {
        // ignore malformed
      }
    } else if (op.name === "Write") {
      try {
        const parsed = parseWriteInput(op.input);
        cur.additions += lineCount(parsed.content);
      } catch {
        // ignore
      }
    }
    files.set(path, cur);
  }
  if (files.size === 0) return null;

  let additions = 0;
  let deletions = 0;
  let primaryFile: string | undefined;
  for (const [path, stats] of files) {
    if (!primaryFile) primaryFile = basename(path);
    additions += stats.additions;
    deletions += stats.deletions;
  }
  return {
    count: files.size,
    additions,
    deletions,
    primaryFile,
  };
}

export interface RestoreCodeResult {
  restored: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Best-effort undo of Write/Edit after `fromUserIndex` through end of transcript
 * (restore workspace to the point before that user message's agent work).
 * NotebookEdit and overwritten Writes without prior content are skipped.
 */
export async function restoreCodeChangesFromTranscript(
  transcript: TranscriptMessage[],
  fromUserIndex: number,
): Promise<RestoreCodeResult> {
  const ops = collectMutatingOps(transcript, fromUserIndex);
  const restored: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const op of [...ops].reverse()) {
    try {
      if (op.name === "Edit") {
        const parsed = parseEditInput(op.input);
        const current = await readFile(parsed.filePath, "utf-8");
        const next = applyStringReplace(
          current,
          parsed.newString,
          parsed.oldString,
          parsed.replaceAll,
        );
        await writeFile(parsed.filePath, next.content, "utf-8");
        restored.push(parsed.filePath);
        continue;
      }
      if (op.name === "Write") {
        const parsed = parseWriteInput(op.input);
        if (op.resultText.includes("File created successfully")) {
          await unlink(parsed.filePath);
          restored.push(parsed.filePath);
        } else {
          skipped.push(parsed.filePath);
        }
        continue;
      }
      if (op.name === "NotebookEdit") {
        const path = toolFilePath(op.name, op.input);
        if (path) skipped.push(path);
        continue;
      }
    } catch (err) {
      const path = toolFilePath(op.name, op.input) ?? op.name;
      errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { restored, skipped, errors };
}
