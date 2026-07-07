import type {
  LLMCompletion,
  LLMMessage,
  LLMRequest,
  LLMStreamChunk,
  ProviderProfile,
  ToolCall,
} from "@kako/shared";
import { getTextContent } from "./provider.js";
import { toOpenAIUserContent } from "./content-blocks.js";

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
    } else if (msg.role === "user") {
      result.push({ role: "user", content: toOpenAIUserContent(msg.content) });
    } else if (msg.role === "assistant") {
      const openaiMsg: OpenAIMessage = {
        role: "assistant",
        content: getTextContent(msg.content) || null,
      };
      if (msg.toolCalls?.length) {
        openaiMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      result.push(openaiMsg);
    } else if (msg.role === "tool") {
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
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
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
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

function chatCompletionsUrl(baseUrl: string, fullUrl?: boolean): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (fullUrl || trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
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

function parseCompletion(data: OpenAIResponse, providerId: string): LLMCompletion {
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
    provider: providerId,
  };
}

export async function openaiCompatibleComplete(
  request: LLMRequest,
  profile: ProviderProfile,
): Promise<LLMCompletion> {
  const response = await fetch(chatCompletionsUrl(profile.baseUrl, profile.fullUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${profile.apiKey ?? ""}`,
    },
    body: JSON.stringify(buildBody(request, request.model, false)),
    ...(request.signal ? { signal: request.signal } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  return parseCompletion(data, profile.id);
}

type StreamDeltaEvent = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      role?: string;
      reasoning_content?: string;
      reasoning?: string;
      thinking?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

/** Stateful SSE parser for OpenAI / doubao / volcengine streaming tool_calls. */
export class OpenAIStreamParser {
  private toolArgs = new Map<number, { id: string; name: string; args: string }>();

  processLine(line: string): LLMStreamChunk[] {
    const chunks: LLMStreamChunk[] = [];
    if (!line.startsWith("data: ")) return chunks;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") {
      if (payload === "[DONE]") chunks.push({ type: "done" });
      return chunks;
    }

    let event: StreamDeltaEvent;
    try {
      event = JSON.parse(payload) as StreamDeltaEvent;
    } catch {
      return chunks;
    }

    const delta = event.choices?.[0]?.delta;
    if (!delta) return chunks;

    const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
    if (typeof reasoning === "string" && reasoning) {
      chunks.push({ type: "reasoning_delta", text: reasoning });
    }

    if (delta.role) chunks.push({ type: "stream_start" });
    if (delta.content) chunks.push({ type: "text_delta", text: delta.content });

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const index = tc.index ?? 0;
        let current = this.toolArgs.get(index);
        if (!current && tc.id) {
          current = { id: tc.id, name: tc.function?.name ?? "", args: "" };
          this.toolArgs.set(index, current);
          chunks.push({
            type: "tool_call_delta",
            toolCall: { id: current.id, name: current.name, input: {} },
          });
        }
        if (current && tc.function?.name && !current.name) {
          current.name = tc.function.name;
        }
        if (current && tc.function?.arguments) {
          current.args += tc.function.arguments;
          this.tryEmitIncrementalToolInput(current, chunks);
        }
      }
    }

    if (event.usage) {
      chunks.push({
        type: "done",
        usage: {
          inputTokens: event.usage.prompt_tokens,
          outputTokens: event.usage.completion_tokens,
          totalTokens: event.usage.total_tokens,
        },
      });
    }

    return chunks;
  }

  flush(): LLMStreamChunk[] {
    const chunks: LLMStreamChunk[] = [];
    for (const tool of this.toolArgs.values()) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tool.args || "{}") as Record<string, unknown>;
      } catch {
        input = {};
      }
      chunks.push({
        type: "tool_call_delta",
        toolCall: { id: tool.id, name: tool.name, input },
      });
    }
    chunks.push({ type: "done" });
    return chunks;
  }

  private tryEmitIncrementalToolInput(
    current: { id: string; name: string; args: string },
    chunks: LLMStreamChunk[],
  ): void {
    try {
      const input = JSON.parse(current.args) as Record<string, unknown>;
      if (input && typeof input === "object" && Object.keys(input).length > 0) {
        chunks.push({
          type: "tool_call_delta",
          toolCall: { id: current.id, name: current.name, input },
        });
      }
    } catch {
      // arguments still streaming
    }
  }
}

/** Parse SSE `data:` lines (OpenAI / doubao / volcengine compatible). Exported for tests. */
export function parseOpenAIStreamLines(lines: string[]): LLMStreamChunk[] {
  const parser = new OpenAIStreamParser();
  const chunks: LLMStreamChunk[] = [];
  for (const line of lines) {
    chunks.push(...parser.processLine(line));
  }
  chunks.push(...parser.flush());
  return chunks;
}

export async function* openaiCompatibleStream(
  request: LLMRequest,
  profile: ProviderProfile,
): AsyncIterable<LLMStreamChunk> {
  const response = await fetch(chatCompletionsUrl(profile.baseUrl, profile.fullUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${profile.apiKey ?? ""}`,
    },
    body: JSON.stringify(buildBody(request, request.model, true)),
    ...(request.signal ? { signal: request.signal } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    yield { type: "error", error: `LLM API error ${response.status}: ${text}` };
    return;
  }

  yield { type: "stream_start" };

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: "error", error: "No response body" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const parser = new OpenAIStreamParser();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        for (const chunk of parser.processLine(line)) {
          yield chunk;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (buffer.trim()) {
    for (const chunk of parser.processLine(buffer)) {
      yield chunk;
    }
  }

  for (const chunk of parser.flush()) {
    yield chunk;
  }
}
