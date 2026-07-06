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
import { toOpenAIUserContent } from "../content-blocks.js";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<Record<string, unknown>>;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function toOpenAIMessages(messages: LLMMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: getTextContent(msg.content) });
      continue;
    }
    if (msg.role === "user") {
      result.push({ role: "user", content: toOpenAIUserContent(msg.content) });
      continue;
    }
    if (msg.role === "assistant") {
      const openaiMsg: OpenAIMessage = {
        role: "assistant",
        content: getTextContent(msg.content) || null,
      };
      if (msg.toolCalls?.length) {
        openaiMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          },
        }));
      }
      result.push(openaiMsg);
      continue;
    }
    if (msg.role === "tool") {
      result.push({
        role: "tool",
        content: getTextContent(msg.content),
        tool_call_id: msg.toolCallId,
      });
    }
  }

  return result;
}

function buildBody(
  request: LLMRequest,
  model: string,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAIMessages(request.messages),
    stream,
  };
  if (request.maxTokens !== undefined) {
    body.max_tokens = request.maxTokens;
  }
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
  if (request.toolChoice !== undefined) {
    body.tool_choice =
      typeof request.toolChoice === "object"
        ? { type: "function", function: { name: request.toolChoice.name } }
        : request.toolChoice;
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (stream) {
    body.stream_options = { include_usage: true };
  }
  return body;
}

interface OpenAIResponse {
  model: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function parseCompletion(data: OpenAIResponse): LLMCompletion {
  const choice = data.choices[0];
  const message = choice?.message;
  const toolCalls: ToolCall[] =
    message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
    })) ?? [];

  const finishReason = choice?.finish_reason;
  return {
    content: message?.content ?? "",
    toolCalls: toolCalls.length ? toolCalls : undefined,
    finishReason:
      finishReason === "tool_calls"
        ? "tool_calls"
        : finishReason === "length"
          ? "length"
          : "stop",
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
    model: data.model,
    provider: "openai",
  };
}

async function* parseOpenAIStream(
  response: Response,
): AsyncIterable<LLMStreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: "error", error: "No response body" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const toolArgs = new Map<number, { id: string; name: string; args: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") {
        if (payload === "[DONE]") {
          yield { type: "done" };
        }
        continue;
      }

      let event: OpenAIStreamEvent;
      try {
        event = JSON.parse(payload) as OpenAIStreamEvent;
      } catch {
        continue;
      }

      const delta = event.choices?.[0]?.delta;
      if (delta?.content) {
        yield { type: "text_delta", text: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index ?? 0;
          let current = toolArgs.get(index);
          if (!current && tc.id) {
            current = { id: tc.id, name: tc.function?.name ?? "", args: "" };
            toolArgs.set(index, current);
            yield {
              type: "tool_call_delta",
              toolCall: { id: current.id, name: current.name, input: {} },
            };
          }
          if (current && tc.function?.arguments) {
            current.args += tc.function.arguments;
          }
        }
      }

      if (event.usage) {
        yield {
          type: "done",
          usage: {
            inputTokens: event.usage.prompt_tokens,
            outputTokens: event.usage.completion_tokens,
            totalTokens: event.usage.total_tokens,
          },
        };
      }
    }
  }

  for (const tool of toolArgs.values()) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tool.args || "{}") as Record<string, unknown>;
    } catch {
      input = {};
    }
    yield {
      type: "tool_call_delta",
      toolCall: { id: tool.id, name: tool.name, input },
    };
  }
}

interface OpenAIStreamEvent {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export const openaiProvider: LLMProviderAdapter = {
  id: "openai",

  async complete(request, model, config) {
    const baseUrl = config.baseUrl ?? "https://api.openai.com";
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey ?? ""}`,
      },
      body: JSON.stringify(buildBody(request, model, false)),
      signal: request.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    return parseCompletion(data);
  },

  async *stream(request, model, config) {
    const baseUrl = config.baseUrl ?? "https://api.openai.com";
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey ?? ""}`,
      },
      body: JSON.stringify(buildBody(request, model, true)),
      signal: request.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      yield { type: "error", error: `OpenAI API error ${response.status}: ${text}` };
      return;
    }

    yield* parseOpenAIStream(response);
  },
};
