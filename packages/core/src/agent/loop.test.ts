import { describe, expect, it, vi } from "vitest";
import type { LLMMessage, LLMStreamChunk, LLMRouter, ToolCall } from "@kako/shared";
import { runAgentLoop } from "./loop.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolLogger } from "../observability/tool-logger.js";
import { createMockRouter } from "./test/mock-router.js";
import { agentToolDefinition, createAgentHandler } from "../tools/builtin/agent-tool.js";
import { registerBuiltinTools } from "../tools/builtin/registry.js";

const baseContext = {
  agentId: "agent-main",
  sessionId: "sess-1",
  toolUseId: "tu-1",
  cwd: "/tmp",
};

function echoRegistry(): ToolRegistry {
  const registry = new ToolRegistry(baseContext);
  registry.register(
    {
      name: "Echo",
      description: "echo",
      inputSchema: { type: "object", properties: { value: { type: "string" } } },
    },
    async (input) => `echo:${input.value}`,
  );
  return registry;
}

describe("runAgentLoop", () => {
  it("returns text when the model stops without tool calls", async () => {
    const router = createMockRouter([{ text: "hello world" }]);
    const messages: LLMMessage[] = [{ role: "user", content: "hi" }];

    const result = await runAgentLoop({
      router,
      registry: echoRegistry(),
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Echo"],
      model: "test-model",
      maxTurns: 5,
    });

    expect(result).toBe("hello world");
    expect(router.callCount()).toBe(1);
  });

  it("pivots context when Skill is the only tool call", async () => {
    const registry = new ToolRegistry(baseContext);
    registry.register(
      { name: "Skill", description: "skill", inputSchema: { type: "object", properties: {} } },
      async () => "activated",
    );

    const router = createMockRouter([
      {
        toolCalls: [{ id: "tu-skill", name: "Skill", input: { skill: "demo", args: "task details" } }],
      },
      { text: "skill output" },
    ]);
    const messages: LLMMessage[] = [
      { role: "system", content: "base" },
      { role: "user", content: "start task" },
    ];

    const result = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Skill"],
      model: "test-model",
      maxTurns: 5,
      onSkillActivate: async () => [
        { role: "system", content: "base\n<system-reminder>skill body</system-reminder>" },
        { role: "user", content: "start task" },
        { role: "user", content: "task details" },
      ],
    });

    expect(result).toBe("skill output");
    expect(router.callCount()).toBe(2);
    expect(messages.some((m) => m.role === "tool")).toBe(false);
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "task details" });
  });

  it("executes tools and feeds results into the next model call", async () => {
    const router = createMockRouter([
      {
        text: "calling",
        toolCalls: [{ id: "tu-a", name: "Echo", input: { value: "ping" } }],
      },
      { text: "done after tool" },
    ]);
    const messages: LLMMessage[] = [{ role: "user", content: "run echo" }];

    const result = await runAgentLoop({
      router,
      registry: echoRegistry(),
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Echo"],
      model: "test-model",
      maxTurns: 5,
    });

    expect(result).toBe("done after tool");
    expect(router.callCount()).toBe(2);
    expect(messages.some((m) => m.role === "tool" && m.content === "echo:ping")).toBe(true);
  });

  it("stops after maxTurns when the model keeps requesting tools (no infinite loop)", async () => {
    const endlessToolCall: ToolCall = {
      id: "tu-loop",
      name: "Echo",
      input: { value: "again" },
    };
    const router = createMockRouter(
      Array.from({ length: 10 }, () => ({
        text: "more",
        toolCalls: [endlessToolCall],
      })),
    );
    const messages: LLMMessage[] = [{ role: "user", content: "loop" }];

    const result = await runAgentLoop({
      router,
      registry: echoRegistry(),
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Echo"],
      model: "test-model",
      maxTurns: 3,
    });

    expect(result).toBe("");
    expect(router.callCount()).toBe(3);
    const toolMessages = messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(3);
  });

  it("blocks nested Agent tool calls without invoking spawn host", async () => {
    const spawn = vi.fn(async () => "should not run");
    const registry = echoRegistry();
    registry.register(agentToolDefinition, createAgentHandler({ spawnSubAgent: spawn }));

    const router = createMockRouter([
      {
        toolCalls: [
          {
            id: "tu-nested",
            name: "Agent",
            input: { description: "bad nest", prompt: " recurse" },
          },
        ],
      },
      { text: "recovered" },
    ]);
    const messages: LLMMessage[] = [{ role: "user", content: "try nest" }];

    const result = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Agent", "Echo"],
      model: "test-model",
      maxTurns: 5,
      blockAgentTool: true,
    });

    expect(spawn).not.toHaveBeenCalled();
    expect(result).toBe("recovered");
    expect(
      messages.some(
        (m) =>
          m.role === "tool" &&
          m.content.includes("Sub-agents cannot spawn nested Agent tools"),
      ),
    ).toBe(true);
  });

  it("stops the loop when user declines AskUserQuestion (Esc)", async () => {
    const askUserQuestion = vi.fn(async () => ({ answers: {}, declined: true }));
    const registry = new ToolRegistry({
      ...baseContext,
      askUserQuestion,
    });
    registerBuiltinTools(registry);

    const router = createMockRouter([
      {
        toolCalls: [
          {
            id: "tu-q",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "Pick one?",
                  header: "Choice",
                  multiSelect: false,
                  options: [
                    { label: "A", description: "first" },
                    { label: "B", description: "second" },
                  ],
                },
              ],
            },
          },
        ],
      },
      { text: "should not run after decline" },
    ]);

    const messages: LLMMessage[] = [{ role: "user", content: "反问我一个问题，让我可以选择" }];
    const result = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["AskUserQuestion"],
      model: "test-model",
      maxTurns: 5,
    });

    expect(askUserQuestion).toHaveBeenCalledTimes(1);
    expect(router.callCount()).toBe(1);
    expect(result).toBe("");
    expect(
      messages.some(
        (m) => m.role === "tool" && typeof m.content === "string" && m.content.includes("cancelled"),
      ),
    ).toBe(true);
  });

  it("continues the loop when user partially answered then dismissed AskUserQuestion", async () => {
    const askUserQuestion = vi.fn(async () => ({
      answers: { "Pick one?": "A" },
      declined: true,
    }));
    const registry = new ToolRegistry({
      ...baseContext,
      askUserQuestion,
    });
    registerBuiltinTools(registry);

    const router = createMockRouter([
      {
        toolCalls: [
          {
            id: "tu-q",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "Pick one?",
                  header: "Choice",
                  multiSelect: false,
                  options: [
                    { label: "A", description: "first" },
                    { label: "B", description: "second" },
                  ],
                },
              ],
            },
          },
        ],
      },
      { text: "continuing with partial answer" },
    ]);

    const messages: LLMMessage[] = [{ role: "user", content: "question" }];
    const result = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["AskUserQuestion"],
      model: "test-model",
      maxTurns: 5,
    });

    expect(askUserQuestion).toHaveBeenCalledTimes(1);
    expect(router.callCount()).toBe(2);
    expect(result).toBe("continuing with partial answer");
  });

  it("aborts streaming when shouldAbort returns true", async () => {
    const onTextDelta = vi.fn();
    const onAnswerRollback = vi.fn();
    let abort = false;
    const router = createMockRouter([{ text: "partial answer that should be rolled back" }]);

    const result = await runAgentLoop({
      router,
      registry: echoRegistry(),
      toolLogger: new ToolLogger(),
      messages: [{ role: "user", content: "hello" }],
      allowedTools: ["Echo"],
      model: "test-model",
      maxTurns: 3,
      callbacks: { onTextDelta, onAnswerRollback },
      shouldAbort: () => {
        if (onTextDelta.mock.calls.length > 0) abort = true;
        return abort;
      },
    });

    expect(onTextDelta).toHaveBeenCalled();
    expect(onAnswerRollback).toHaveBeenCalled();
    expect(result).toBe("");
  });

  it("aborts while waiting for the first stream chunk", async () => {
    const router: LLMRouter & { callCount: () => number } = {
      callCount: () => 1,
      async complete() {
        throw new Error("mock complete not implemented");
      },
      stream(): AsyncIterable<LLMStreamChunk> {
        return {
          async *[Symbol.asyncIterator]() {
            await new Promise((resolve) => setTimeout(resolve, 500));
            yield { type: "text_delta", text: "late" };
            yield { type: "done", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
          },
        };
      },
    };

    const started = Date.now();
    const result = await runAgentLoop({
      router,
      registry: echoRegistry(),
      toolLogger: new ToolLogger(),
      messages: [{ role: "user", content: "hello" }],
      allowedTools: ["Echo"],
      model: "test-model",
      maxTurns: 1,
      shouldAbort: () => true,
    });
    const elapsed = Date.now() - started;

    expect(result).toBe("");
    expect(elapsed).toBeLessThan(200);
  });

  it("invokes onReasoningEnd when reasoning stops before answer", async () => {
    const onReasoningEnd = vi.fn();
    const router = createMockRouter([
      { reasoning: "think", text: "hello" },
    ]);

    await runAgentLoop({
      router,
      registry: echoRegistry(),
      toolLogger: new ToolLogger(),
      messages: [{ role: "user", content: "hi" }],
      allowedTools: ["Echo"],
      model: "test-model",
      maxTurns: 1,
      callbacks: { onReasoningEnd },
    });

    expect(onReasoningEnd).toHaveBeenCalledTimes(1);
  });

  it("invokes callbacks when provided (main agent path)", async () => {
    const onTextDelta = vi.fn();
    const router = createMockRouter([{ text: "visible output" }]);

    await runAgentLoop({
      router,
      registry: echoRegistry(),
      toolLogger: new ToolLogger(),
      messages: [{ role: "user", content: "main" }],
      allowedTools: ["Echo"],
      model: "test-model",
      maxTurns: 1,
      callbacks: { onTextDelta },
    });

    expect(onTextDelta).toHaveBeenCalledWith("visible output");
  });
});
