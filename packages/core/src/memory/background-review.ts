import type {
  FactMergeDecision,
  LLMRouter,
  ProviderRegistry,
  SessionId,
  TranscriptMessage,
} from "@kako/shared";
import type { MemorySettings } from "../config/memory-store.js";
import {
  isBackgroundReviewEnabled,
  isWriteApprovalEnabled,
} from "../config/memory-store.js";
import {
  beginMemoryLlmCall,
  recordMemoryLlmCall,
  releaseMemoryLlmSlot,
} from "./budget.js";
import {
  addCuratedEntry,
  removeCuratedEntry,
  replaceCuratedEntry,
  type CuratedTarget,
} from "./curated-store.js";
import { applyFactDecisions } from "./facts.js";
import { stageMemoryWrite, type PendingMemoryOp } from "./pending.js";

export const BACKGROUND_REVIEW_SYSTEM_PROMPT = `You review a bounded conversation digest and return JSON only.
Return a single JSON object:
{
  "curated": [ { "target": "notes"|"user", "action": "add"|"replace"|"remove", "content"?: string, "oldText"?: string } ],
  "facts": [ { "action": "ADD"|"UPDATE"|"DELETE"|"NOOP", "factId"?: string, "content"?: string, "confidence"?: number, "reason": string } ]
}

Rules:
- Use only information present in the digest.
- Prefer no-ops when nothing durable changed.
- Keep curated entries concise.
- Do not invent facts.
- Raw JSON preferred; no tools.`;

export interface BackgroundReviewOps {
  curated: Array<{
    target: CuratedTarget;
    action: "add" | "replace" | "remove";
    content?: string;
    oldText?: string;
  }>;
  facts: FactMergeDecision[];
}

function isFactDecision(value: unknown): value is FactMergeDecision {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.action !== "ADD" && v.action !== "UPDATE" && v.action !== "DELETE" && v.action !== "NOOP") {
    return false;
  }
  return typeof v.reason === "string";
}

export function parseBackgroundReviewOps(content: string): BackgroundReviewOps | null {
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
        curated?: unknown;
        facts?: unknown;
      };
      const curated: BackgroundReviewOps["curated"] = [];
      if (Array.isArray(parsed.curated)) {
        for (const item of parsed.curated) {
          if (!item || typeof item !== "object") continue;
          const c = item as Record<string, unknown>;
          const target = c.target;
          const action = c.action;
          if ((target !== "notes" && target !== "user") ||
              (action !== "add" && action !== "replace" && action !== "remove")) {
            continue;
          }
          curated.push({
            target,
            action,
            content: typeof c.content === "string" ? c.content : undefined,
            oldText: typeof c.oldText === "string" ? c.oldText : undefined,
          });
        }
      }
      const facts = Array.isArray(parsed.facts)
        ? parsed.facts.filter(isFactDecision)
        : [];
      return { curated, facts };
    } catch {
      // next
    }
  }
  return null;
}

export function buildBackgroundReviewDigest(
  transcript: TranscriptMessage[],
  maxChars: number,
): string {
  const lines: string[] = [];
  for (const m of transcript) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    // Skip empty display rows (e.g. harness task-notification with content="" + metadata.llmText).
    const text = m.content.trim();
    if (!text) continue;
    const prefix = m.role === "user" ? "User" : "Assistant";
    lines.push(`${prefix}: ${m.content}`);
  }
  let text = lines.join("\n\n");
  if (text.length <= maxChars) return text;
  // Keep recent tail under cap
  text = text.slice(text.length - maxChars);
  const cut = text.indexOf("\n\n");
  return cut > 0 && cut < 200 ? text.slice(cut + 2) : text;
}

/**
 * Background Review is only worth an LLM call when this turn added a real user
 * question (typed text / attachments) or an assistant body reply.
 * System/tool/protocol-only changes (empty CLI text + harness llmText only, no
 * model reply) must not trigger review.
 */
export function hasSubstantiveReviewSignal(opts: {
  userTurnText?: string;
  assistantResponseText?: string;
  hasUserAttachments?: boolean;
}): boolean {
  if (opts.userTurnText?.trim()) return true;
  if (opts.hasUserAttachments) return true;
  if (opts.assistantResponseText?.trim()) return true;
  return false;
}

async function applyCuratedOps(
  ops: BackgroundReviewOps["curated"],
  settings: MemorySettings,
): Promise<void> {
  for (const op of ops) {
    if (op.action === "add" && op.content) {
      await addCuratedEntry(op.target, op.content, settings);
    } else if (op.action === "replace" && op.oldText && op.content) {
      await replaceCuratedEntry(op.target, op.oldText, op.content, settings);
    } else if (op.action === "remove" && op.oldText) {
      await removeCuratedEntry(op.target, op.oldText, settings);
    }
  }
}

export async function runBackgroundReview(opts: {
  sessionId: SessionId;
  transcript: TranscriptMessage[];
  router: LLMRouter;
  mainModel: string;
  settings: MemorySettings;
  registry?: ProviderRegistry;
  /** Visible user ask for this turn (empty for async task-notification wakes). */
  userTurnText?: string;
  /** Assistant reply body produced this turn (allows review after bg task completes). */
  assistantResponseText?: string;
  hasUserAttachments?: boolean;
}): Promise<{ ran: boolean; skippedReason?: string }> {
  const { settings } = opts;
  if (!isBackgroundReviewEnabled(settings)) {
    return { ran: false, skippedReason: "disabled" };
  }
  if (
    !hasSubstantiveReviewSignal({
      userTurnText: opts.userTurnText,
      assistantResponseText: opts.assistantResponseText,
      hasUserAttachments: opts.hasUserAttachments,
    })
  ) {
    return { ran: false, skippedReason: "no_substantive_content" };
  }
  if (!opts.transcript.some((m) => {
    if (m.role !== "user" && m.role !== "assistant") return false;
    return m.content.trim().length > 0;
  })) {
    return { ran: false, skippedReason: "empty" };
  }

  const gate = await beginMemoryLlmCall("backgroundReview", settings);
  if (!gate.ok) {
    return { ran: false, skippedReason: gate.reason };
  }

  try {
    const digest = buildBackgroundReviewDigest(
      opts.transcript,
      settings.backgroundReview.digestMaxChars,
    );
    const model = settings.backgroundReview.model?.trim() || opts.mainModel;
    const completion = await opts.router.complete({
      model,
      messages: [
        { role: "system", content: BACKGROUND_REVIEW_SYSTEM_PROMPT },
        { role: "user", content: digest },
      ],
      temperature: 0.2,
      maxTokens: 2048,
    });
    await recordMemoryLlmCall("backgroundReview");

    const ops = parseBackgroundReviewOps(completion.content);
    if (!ops) {
      return { ran: true, skippedReason: "parse_failed" };
    }

    const pendingOps: PendingMemoryOp[] = [];
    if (settings.backgroundReview.updateCurated && ops.curated.length) {
      for (const c of ops.curated) {
        pendingOps.push({ kind: "curated", ...c });
      }
    }
    if (settings.backgroundReview.extractFacts && ops.facts.length) {
      pendingOps.push({ kind: "facts", decisions: ops.facts });
    }

    if (!pendingOps.length) {
      return { ran: true };
    }

    if (isWriteApprovalEnabled(settings)) {
      await stageMemoryWrite(pendingOps, "backgroundReview");
      return { ran: true };
    }

    if (settings.backgroundReview.updateCurated) {
      await applyCuratedOps(ops.curated, settings);
    }
    if (settings.backgroundReview.extractFacts && ops.facts.length) {
      await applyFactDecisions(ops.facts);
    }
    return { ran: true };
  } catch {
    await releaseMemoryLlmSlot();
    return { ran: false, skippedReason: "error" };
  }
}

export function scheduleBackgroundReview(
  opts: Parameters<typeof runBackgroundReview>[0],
  onDone?: (result: { ran: boolean; skippedReason?: string }) => void,
): void {
  void runBackgroundReview(opts)
    .then((r) => onDone?.(r))
    .catch(() => {
      onDone?.({ ran: false, skippedReason: "error" });
    });
}
