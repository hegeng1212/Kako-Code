import type {
  LLMCompletion,
  LLMMessage,
  LLMProviderConfig,
  LLMRequest,
  LLMStreamChunk,
  ToolCall,
} from "@kako/shared";
import type { LLMProviderAdapter } from "../provider.js";
import { getTextContent } from "../provider.js";
import {
  toAnthropicToolResultContent,
  toAnthropicUserBlocks,
} from "../content-blocks.js";

const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | Array<Record<string, unknown>> };

function toAnthropicMessages(
  messages: LLMMessage[],
): { system: string; messages: AnthropicMessage[] } {
  let system = "";
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system += (system ? "\n\n" : "") + getTextContent(msg.content);
      continue;
    }
    if (msg.role === "user") {
      result.push({
        role: "user",
        content: toAnthropicUserBlocks(msg.content) as AnthropicContentBlock[],
      });
      continue;
    }
    if (msg.role === "assistant") {
      const content: AnthropicContentBlock[] = [];
      const text = getTextContent(msg.content);
      if (text) content.push({ type: "text", text });
      for (const tc of msg.toolCalls ?? []) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      result.push({ role: "assistant", content });
      continue;
    }
    if (msg.role === "tool") {
      result.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolCallId ?? "",
            content: toAnthropicToolResultContent(msg.content),
          },
        ],
      });
    }
  }

  return { system, messages: result };
}

function buildBody(
  request: LLMRequest,
  model: string,
  stream: boolean,
): Record<string, unknown> {
  const { system, messages } = toAnthropicMessages(request.messages);
  const body: Record<string, unknown> = {
    model,
    max_tokens: request.maxTokens ?? 8192,
    messages,
    stream,
  };
  if (system) {
    body.system = system;
  }
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }
  if (request.toolChoice !== undefined) {
    body.tool_choice =
      typeof request.toolChoice === "object"
        ? { type: "tool", name: request.toolChoice.name }
        : request.toolChoice;
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  return body;
}

function parseCompletion(data: AnthropicResponse): LLMCompletion {
  const textBlocks = data.content.filter(
    (b): b is { type: "text"; text: string } => b.type === "text",
  );
  const toolBlocks = data.content.filter(
    (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
      b.type === "tool_use",
  );

  const toolCalls: ToolCall[] = toolBlocks.map((b) => ({
    id: b.id,
    name: b.name,
    input: b.input,
  }));

  return {
    content: textBlocks.map((b) => b.text).join(""),
    toolCalls: toolCalls.length ? toolCalls : undefined,
    finishReason:
      data.stop_reason === "tool_use"
        ? "tool_calls"
        : data.stop_reason === "max_tokens"
          ? "length"
          : "stop",
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    },
    model: data.model,
    provider: "anthropic",
  };
}

interface AnthropicResponse {
  model: string;
  stop_reason: string | null;
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  usage: { input_tokens: number; output_tokens: number };
}

async function* parseAnthropicStream(
  response: Response,
): AsyncIterable<LLMStreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: "error", error: "No response body" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const toolInputs = new Map<string, { id: string; name: string; json: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;

      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(payload) as AnthropicStreamEvent;
      } catch {
        continue;
      }

      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta" && delta.text) {
          yield { type: "text_delta", text: delta.text };
        }
        if (delta.type === "input_json_delta" && delta.partial_json) {
          const current = toolInputs.get(event.index.toString());
          if (current) {
            current.json += delta.partial_json;
          }
        }
      }

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use") {
          toolInputs.set(event.index.toString(), {
            id: block.id,
            name: block.name,
            json: "",
          });
          yield {
            type: "tool_call_delta",
            toolCall: { id: block.id, name: block.name, input: {} },
          };
        }
      }

      if (event.type === "message_delta" && event.usage) {
        yield {
          type: "done",
          usage: {
            inputTokens: 0,
            outputTokens: event.usage.output_tokens,
            totalTokens: event.usage.output_tokens,
          },
        };
      }

      if (event.type === "message_stop") {
        for (const tool of toolInputs.values()) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tool.json || "{}") as Record<string, unknown>;
          } catch {
            input = {};
          }
          yield {
            type: "tool_call_delta",
            toolCall: { id: tool.id, name: tool.name, input },
          };
        }
        yield { type: "done" };
      }
    }
  }
}

type AnthropicStreamEvent =
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "input_json_delta"; partial_json: string };
    }
  | {
      type: "content_block_start";
      index: number;
      content_block:
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string };
    }
  | { type: "message_delta"; usage: { output_tokens: number } }
  | { type: "message_stop" };

export const anthropicProvider: LLMProviderAdapter = {
  id: "anthropic",

  async complete(request, model, config) {
    const baseUrl = config.baseUrl ?? "https://api.anthropic.com";
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey ?? "",
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(buildBody(request, model, false)),
      signal: request.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    return parseCompletion(data);
  },

  async *stream(request, model, config) {
    const baseUrl = config.baseUrl ?? "https://api.anthropic.com";
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey ?? "",
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(buildBody(request, model, true)),
      signal: request.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      yield { type: "error", error: `Anthropic API error ${response.status}: ${text}` };
      return;
    }

    yield* parseAnthropicStream(response);
  },
};
