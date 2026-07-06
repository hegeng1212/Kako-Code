import type { LLMRequest, LLMStreamChunk, LLMRouter, ToolCall } from "@kako/shared";

/** Scripted stream responses for agent loop tests. */
export interface StreamScenario {
  text?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
}

export function createMockRouter(scenarios: StreamScenario[]): LLMRouter & {
  callCount: () => number;
} {
  let calls = 0;

  return {
    callCount: () => calls,
    async complete() {
      throw new Error("mock complete not implemented");
    },
    stream(_request: LLMRequest): AsyncIterable<LLMStreamChunk> {
      const index = calls++;
      const scenario = scenarios[index] ?? { text: "" };
      return streamScenario(scenario);
    },
  };
}

async function* streamScenario(scenario: StreamScenario): AsyncIterable<LLMStreamChunk> {
  if (scenario.reasoning) {
    yield { type: "reasoning_delta", text: scenario.reasoning };
  }
  if (scenario.text) {
    yield { type: "text_delta", text: scenario.text };
  }
  for (const toolCall of scenario.toolCalls ?? []) {
    yield {
      type: "tool_call_delta",
      toolCall: { id: toolCall.id, name: toolCall.name, input: toolCall.input },
    };
  }
  yield { type: "done", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
}
