import type { ToolCall } from "./tool.js";

/** Provider identifier — built-in or user-defined. */
export type LLMProviderId = string;

/** A message in the unified LLM conversation format. */
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | LLMContentBlock[];
  toolCallId?: string;
  name?: string;
  /** Tool calls made by the assistant (for multi-turn tool loops). */
  toolCalls?: ToolCall[];
}

export type LLMContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: string; mediaType?: string };

/** Tool definition passed to the LLM for function calling. */
export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Non-streaming completion response. */
export interface LLMCompletion {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage: LLMTokenUsage;
  model: string;
  provider: LLMProviderId;
}

export interface LLMTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Streaming chunk from an LLM provider. */
export interface LLMStreamChunk {
  type: "text_delta" | "reasoning_delta" | "tool_call_delta" | "stream_start" | "done" | "error";
  text?: string;
  toolCall?: Partial<ToolCall>;
  usage?: LLMTokenUsage;
  error?: string;
}

/** Force or restrict tool selection (OpenAI / Anthropic compatible). */
export type LLMToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; name: string };

/** Request parameters for LLM completion. */
export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  toolChoice?: LLMToolChoice;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** Provider configuration entry. */
export interface LLMProviderConfig {
  id: LLMProviderId;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  enabled: boolean;
}

/** Routing strategy for model selection and fallback. */
export interface LLMRoutingConfig {
  defaultModel: string;
  fallbackChain?: string[];
  maxRetries?: number;
  retryDelayMs?: number;
}

/** Core LLM router interface (implementation in @kako/core). */
export interface LLMRouter {
  complete(request: LLMRequest): Promise<LLMCompletion>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}
