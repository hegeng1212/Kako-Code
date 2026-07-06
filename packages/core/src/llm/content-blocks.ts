import type { LLMContentBlock, LLMMessage } from "@kako/shared";

export function getTextContent(content: LLMMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function contentHasImages(content: LLMMessage["content"]): boolean {
  return typeof content !== "string" && content.some((block) => block.type === "image");
}

export function toOpenAIUserContent(
  content: LLMMessage["content"],
): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  const parts: Array<Record<string, unknown>> = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      const mediaType = block.mediaType ?? "image/png";
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${mediaType};base64,${block.source}`,
        },
      });
    }
  }
  return parts.length === 1 && parts[0]?.type === "text"
    ? String((parts[0] as { text: string }).text)
    : parts;
}

export function toAnthropicUserBlocks(
  content: LLMMessage["content"],
): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: block.mediaType ?? "image/png",
        data: block.source,
      },
    };
  });
}

export function toAnthropicToolResultContent(
  content: LLMMessage["content"],
): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  if (!content.some((block) => block.type === "image")) {
    return getTextContent(content);
  }
  return toAnthropicUserBlocks(content);
}

export function mergeTextWithBlocks(
  prefix: string,
  content: string | LLMContentBlock[],
): string | LLMContentBlock[] {
  if (typeof content === "string") {
    return `${prefix}\n\n${content}`;
  }
  return [{ type: "text", text: prefix }, ...content];
}
