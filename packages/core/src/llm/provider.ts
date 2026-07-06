import type {
  LLMCompletion,
  LLMMessage,
  LLMProviderConfig,
  LLMRequest,
  LLMStreamChunk,
  LLMToolDefinition,
} from "@kako/shared";

export interface LLMProviderAdapter {
  id: LLMProviderConfig["id"];
  complete(
    request: LLMRequest,
    model: string,
    config: LLMProviderConfig,
  ): Promise<LLMCompletion>;
  stream(
    request: LLMRequest,
    model: string,
    config: LLMProviderConfig,
  ): AsyncIterable<LLMStreamChunk>;
}

export function getTextContent(content: LLMMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export function toolsToJsonSchema(
  tools: LLMToolDefinition[] | undefined,
): LLMToolDefinition[] {
  return tools ?? [];
}
