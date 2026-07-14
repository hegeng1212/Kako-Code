import type { SessionAgentState } from "@kako/shared";
import type { SessionId } from "@kako/shared";
import { loadL1Document, writeL1Document } from "./compact.js";
import type { L1SummaryDocument } from "./l1.js";

/**
 * Agents DetailLog (`agentState.detail`) must NOT enter model RAG / buildMessages.
 * These helpers only share milestone text between UI classifier state and L1 sections.
 */

/** Derive a short Agents list preview from L1 (Next or Goal), for UI only. */
export function detailPreviewFromL1(doc: L1SummaryDocument | null): string | undefined {
  if (!doc) return undefined;
  const next = doc.sections.Next?.trim();
  if (next && next !== "(none)") return next.slice(0, 64);
  const goal = doc.sections.Goal?.trim();
  if (goal && goal !== "(none)") return goal.slice(0, 64);
  return undefined;
}

/**
 * Feed a classifier milestone into L1 Next / Historical Context.
 * Does not invent semantic meaning — stores the detail string as a milestone line.
 */
export async function feedClassifierMilestoneToL1(
  sessionId: SessionId,
  agentState: Pick<SessionAgentState, "state" | "detail">,
): Promise<L1SummaryDocument | null> {
  const detail = agentState.detail?.trim();
  if (!detail) return null;

  const existing = await loadL1Document(sessionId);
  if (!existing) {
    // No L1 yet — UI detail remains UI-only until consolidate creates L1.
    return null;
  }

  const milestone = `[${agentState.state}] ${detail}`;
  const next = existing.sections.Next?.trim();
  const updatedNext =
    !next || next === "(none)" ? milestone : `${milestone}\n${next}`.slice(0, 1200);

  const hist = existing.sections["Historical Context"]?.trim() || "";
  const histLine = `Milestone: ${milestone}`;
  const updatedHist = hist.includes(histLine)
    ? hist
    : [histLine, hist === "(none)" ? "" : hist].filter(Boolean).join("\n\n");

  const doc: L1SummaryDocument = {
    ...existing,
    frontmatter: {
      ...existing.frontmatter,
      updatedAt: new Date().toISOString(),
    },
    sections: {
      ...existing.sections,
      Next: updatedNext,
      "Historical Context": updatedHist || "(none)",
    },
  };
  await writeL1Document(sessionId, doc);
  return doc;
}

/**
 * Prefer classifier detail for Agents UI; fall back to L1-derived preview.
 * Never used for model context assembly.
 */
export function resolveAgentsDetailPreview(
  agentState: SessionAgentState | undefined,
  l1: L1SummaryDocument | null,
): string {
  const fromState = agentState?.detail?.trim();
  if (fromState) return fromState.slice(0, 64);
  return detailPreviewFromL1(l1) ?? "";
}
