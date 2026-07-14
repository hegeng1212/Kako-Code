import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";
import {
  createPin,
  loadPins,
  savePins,
  selectPinsForInject,
} from "../../memory/pins.js";

export const MEMORY_PIN_DESCRIPTION = `Manage session pins (verbatim short items reinjected each turn).
Actions: add (content required), list, remove (id required).
Adds are rejected when pin count or total bytes exceed inject caps.`;

export const memoryPinToolDefinition: ToolDefinition = {
  name: "MemoryPin",
  description: MEMORY_PIN_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: ["add", "list", "remove"],
        description: "Pin operation.",
      },
      content: {
        type: "string",
        description: "Pin text for add.",
      },
      id: {
        type: "string",
        description: "Pin id for remove.",
      },
    },
    required: ["action"],
  },
};

export const memoryPinHandler: ToolHandler = async (input, context) => {
  const raw = input as { action?: unknown; content?: unknown; id?: unknown };
  const action = String(raw.action ?? "").trim();
  if (action !== "add" && action !== "list" && action !== "remove") {
    throw new Error("action must be add, list, or remove");
  }

  const sessionId = context.sessionId;
  const pins = await loadPins(sessionId);

  if (action === "list") {
    return JSON.stringify({ pins, caps: {
      pinsMaxCount: DEFAULT_MEMORY_INJECT_CAPS.pinsMaxCount,
      pinsMaxBytes: DEFAULT_MEMORY_INJECT_CAPS.pinsMaxBytes,
    } }, null, 2);
  }

  if (action === "remove") {
    const id = String(raw.id ?? "").trim();
    if (!id) throw new Error("id is required for remove");
    const next = pins.filter((p) => p.id !== id);
    await savePins(sessionId, next);
    return JSON.stringify({ removed: id, pins: next }, null, 2);
  }

  const content = String(raw.content ?? "").trim();
  if (!content) throw new Error("content is required for add");

  const candidate = [...pins, createPin(content, "MemoryPin")];
  const accepted = selectPinsForInject(candidate);
  if (accepted.length < candidate.length) {
    return JSON.stringify({
      ok: false,
      error: "pin cap exceeded",
      pins,
      caps: {
        pinsMaxCount: DEFAULT_MEMORY_INJECT_CAPS.pinsMaxCount,
        pinsMaxBytes: DEFAULT_MEMORY_INJECT_CAPS.pinsMaxBytes,
      },
    }, null, 2);
  }

  // Dedup identical content
  if (pins.some((p) => p.content === content)) {
    return JSON.stringify({ ok: true, pins, deduped: true }, null, 2);
  }
  const next = [...pins, createPin(content, "MemoryPin")];
  await savePins(sessionId, next);
  return JSON.stringify({ ok: true, pins: next }, null, 2);
};
