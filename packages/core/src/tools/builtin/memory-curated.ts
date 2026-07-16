import type { ToolDefinition, ToolHandler } from "@kako/shared";
import {
  isMemoryToolEnabled,
  loadMemorySettings,
} from "../../config/memory-store.js";
import {
  addCuratedEntry,
  curatedUsage,
  formatUsage,
  loadCuratedEntries,
  removeCuratedEntry,
  replaceCuratedEntry,
  type CuratedTarget,
} from "../../memory/curated-store.js";
import { isWriteApprovalEnabled } from "../../config/memory-store.js";
import { stageMemoryWrite } from "../../memory/pending.js";

export const MEMORY_CURATED_DESCRIPTION = `Manage bounded curated memory (notes or user profile entries).
Actions: add, replace, remove, list.
target: notes (session-spanning preferences/facts) or user (profile tags/traits).
replace/remove require unique oldText substring. Over-cap adds return error with current_entries — consolidate then retry.
Writes persist to disk; frozen system inject does not refresh mid-session.`;

export const memoryCuratedToolDefinition: ToolDefinition = {
  name: "Memory",
  description: MEMORY_CURATED_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      target: {
        type: "string",
        enum: ["notes", "user"],
        description: "Curated store target.",
      },
      action: {
        type: "string",
        enum: ["add", "replace", "remove", "list"],
        description: "Memory operation.",
      },
      content: {
        type: "string",
        description: "New text for add or replace.",
      },
      oldText: {
        type: "string",
        description: "Unique substring to locate entry for replace/remove.",
      },
    },
    required: ["target", "action"],
  },
};

function isTarget(v: string): v is CuratedTarget {
  return v === "notes" || v === "user";
}

export const memoryCuratedHandler: ToolHandler = async (input) => {
  const settings = await loadMemorySettings();
  if (!isMemoryToolEnabled(settings)) {
    return JSON.stringify({
      ok: false,
      error: "Memory tool disabled (memoryTool.enabled or curated.enabled is false)",
    });
  }

  const raw = input as {
    target?: unknown;
    action?: unknown;
    content?: unknown;
    oldText?: unknown;
  };
  const target = String(raw.target ?? "").trim();
  const action = String(raw.action ?? "").trim();
  if (!isTarget(target)) {
    throw new Error("target must be notes or user");
  }
  if (action !== "add" && action !== "replace" && action !== "remove" && action !== "list") {
    throw new Error("action must be add, replace, remove, or list");
  }

  const limit =
    target === "notes" ? settings.curated.notesCharLimit : settings.curated.userCharLimit;

  if (action === "list") {
    const entries = await loadCuratedEntries(target);
    const usage = curatedUsage(entries, limit);
    return JSON.stringify({
      target,
      entries,
      usage: formatUsage(usage),
      pct: usage.pct,
    }, null, 2);
  }

  if (isWriteApprovalEnabled(settings) && action !== "list") {
    const id = await stageMemoryWrite(
      [
        {
          kind: "curated",
          target,
          action,
          content: raw.content !== undefined ? String(raw.content) : undefined,
          oldText: raw.oldText !== undefined ? String(raw.oldText) : undefined,
        },
      ],
      "Memory",
    );
    return JSON.stringify({
      ok: true,
      staged: true,
      pendingId: id,
      message: "writeApproval enabled — staged pending approval",
    }, null, 2);
  }

  if (action === "add") {
    const result = await addCuratedEntry(target, String(raw.content ?? ""), settings);
    if (!result.ok) {
      return JSON.stringify(result, null, 2);
    }
    const usage = curatedUsage(result.entries, limit);
    return JSON.stringify({ ok: true, entries: result.entries, usage: formatUsage(usage) }, null, 2);
  }

  if (action === "replace") {
    const result = await replaceCuratedEntry(
      target,
      String(raw.oldText ?? ""),
      String(raw.content ?? ""),
      settings,
    );
    if (!result.ok) return JSON.stringify(result, null, 2);
    const usage = curatedUsage(result.entries, limit);
    return JSON.stringify({ ok: true, entries: result.entries, usage: formatUsage(usage) }, null, 2);
  }

  const result = await removeCuratedEntry(target, String(raw.oldText ?? ""), settings);
  if (!result.ok) return JSON.stringify(result, null, 2);
  const usage = curatedUsage(result.entries, limit);
  return JSON.stringify({ ok: true, entries: result.entries, usage: formatUsage(usage) }, null, 2);
};
