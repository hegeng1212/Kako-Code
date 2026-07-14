import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";
import { searchMemoryFts } from "../../memory/index-fts.js";

export const MEMORY_SEARCH_DESCRIPTION = `Search durable memory layers (session summaries, rolling notes, facts, episodes).
Returns a bounded list of hits (default ≤8) with layer, path, score, snippet (≤700 chars), and optional lineRange.
Use MemoryGet with a hit path + line range when you need full text.
Do not assume snippets are complete or authoritative.`;

export const memorySearchToolDefinition: ToolDefinition = {
  name: "MemorySearch",
  description: MEMORY_SEARCH_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: "Free-text query to search across memory index.",
      },
      limit: {
        type: "number",
        description: `Max hits to return (cap ${DEFAULT_MEMORY_INJECT_CAPS.searchDefaultLimit}).`,
      },
      sessionId: {
        type: "string",
        description: "Optional session scope. Omit with crossSession for broader search.",
      },
      crossSession: {
        type: "boolean",
        description: "When true, search across sessions (default true when sessionId omitted).",
      },
      layers: {
        type: "array",
        items: { type: "string" },
        description: "Optional layer filter: L0 L1 L2 L3 L4 L5.",
      },
    },
    required: ["query"],
  },
};

export const memorySearchHandler: ToolHandler = async (input, context) => {
  const query = String((input as { query?: unknown }).query ?? "").trim();
  if (!query) throw new Error("query is required");

  const raw = input as {
    limit?: unknown;
    sessionId?: unknown;
    crossSession?: unknown;
    layers?: unknown;
  };
  const limit =
    typeof raw.limit === "number" && Number.isFinite(raw.limit)
      ? Math.max(1, Math.floor(raw.limit))
      : undefined;
  const sessionId =
    typeof raw.sessionId === "string" && raw.sessionId.trim()
      ? raw.sessionId.trim()
      : context.sessionId;
  const crossSession =
    typeof raw.crossSession === "boolean" ? raw.crossSession : !raw.sessionId;
  const layers = Array.isArray(raw.layers)
    ? raw.layers.map(String).filter(Boolean)
    : undefined;

  const hits = searchMemoryFts({
    query,
    limit,
    sessionId: sessionId as never,
    crossSession,
    layers: layers as never,
  });

  return JSON.stringify({ hits }, null, 2);
};
