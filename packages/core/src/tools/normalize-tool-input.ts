import type { ToolCall } from "@kako/shared";

/** Decode HTML entities accidentally introduced by XML-style tool transports. */
export function decodeToolInputEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function normalizeToolInputValue(value: unknown): unknown {
  if (typeof value === "string") {
    return decodeToolInputEntities(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeToolInputValue);
  }
  if (value && typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      obj[key] = normalizeToolInputValue(entry);
    }
    return obj;
  }
  return value;
}

/** Normalize streamed tool-call arguments before execution and display. */
export function normalizeToolCallInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return normalizeToolInputValue(input) as Record<string, unknown>;
}

export function normalizeToolCall(toolCall: ToolCall): ToolCall {
  return {
    ...toolCall,
    input: normalizeToolCallInput(toolCall.input),
  };
}
