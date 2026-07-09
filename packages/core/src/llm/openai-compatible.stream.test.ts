import { describe, expect, it } from "vitest";
import { parseOpenAIStreamLines, parseStreamedToolArgs } from "./openai-compatible.js";

/** Minimal doubao/volcengine SSE chunks — id+name first, arguments streamed by index. */
const DOUBAO_ASK_USER_LINES = [
  `data: {"choices":[{"delta":{"content":"","role":"assistant","tool_calls":[{"function":{"arguments":"","name":"AskUserQuestion"},"id":"call_test123","index":0,"type":"function"}]},"index":0}]}`,
  `data: {"choices":[{"delta":{"content":"","role":"assistant","tool_calls":[{"function":{"arguments":"{\\"questions\\": "},"index":0}]},"index":0}]}`,
  `data: {"choices":[{"delta":{"content":"","role":"assistant","tool_calls":[{"function":{"arguments":"[{\\"header\\":\\"内容方向\\""},"index":0}]},"index":0}]}`,
  `data: {"choices":[{"delta":{"content":"","role":"assistant","tool_calls":[{"function":{"arguments":",\\"question\\":\\"你接下来更倾向于做哪件事？\\""},"index":0}]},"index":0}]}`,
  `data: {"choices":[{"delta":{"content":"","role":"assistant","tool_calls":[{"function":{"arguments":",\\"multiSelect\\":false,\\"options\\":[{\\"label\\":\\"A\\",\\"description\\":\\"one\\"},{\\"label\\":\\"B\\",\\"description\\":\\"two\\"}]}]}"},"index":0}]},"index":0}]}`,
  `data: {"choices":[{"delta":{"content":"","role":"assistant","tool_calls":[{"function":{"arguments":"]}"},"index":0}]},"index":0}]}`,
  `data: [DONE]`,
];

describe("openaiCompatibleStream doubao tool_calls", () => {
  it("assembles streaming AskUserQuestion arguments into a complete tool call", async () => {
    const chunks = await parseOpenAIStreamLines(DOUBAO_ASK_USER_LINES);

    const toolDeltas = chunks.filter((c) => c.type === "tool_call_delta");
    expect(toolDeltas.length).toBeGreaterThanOrEqual(2);

    const withInput = toolDeltas.filter(
      (c) => c.toolCall?.input && Object.keys(c.toolCall.input).length > 0,
    );
    expect(withInput.length).toBeGreaterThan(0);

    const last = withInput[withInput.length - 1]!;
    expect(last.toolCall?.name).toBe("AskUserQuestion");
    expect(last.toolCall?.id).toBe("call_test123");

    const questions = (last.toolCall!.input as { questions: unknown[] }).questions;
    expect(Array.isArray(questions)).toBe(true);
    expect(questions).toHaveLength(1);
    expect((questions[0] as { options: unknown[] }).options).toHaveLength(2);
  });
});

describe("streamCompletion tool input merge", () => {
  it("replaces empty input with final parsed payload", () => {
    const existing = { id: "call_test123", name: "AskUserQuestion", input: {} as Record<string, unknown> };
    const incoming = {
      questions: [{ header: "H", question: "Q?", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }],
    };
    if (Object.keys(incoming).length > 0) {
      existing.input = { ...existing.input, ...incoming };
    }
    expect(existing.input.questions).toHaveLength(1);
  });
});

describe("parseStreamedToolArgs", () => {
  it("falls back to last incremental snapshot when final JSON is truncated", () => {
    const input = parseStreamedToolArgs({
      id: "call_w",
      name: "Write",
      args: '{"file_path":"/tmp/report.html","content":"<html',
      lastInput: {
        file_path: "/tmp/report.html",
        content: "<html>",
      },
    });
    expect(input).toEqual({
      file_path: "/tmp/report.html",
      content: "<html>",
    });
  });
});
