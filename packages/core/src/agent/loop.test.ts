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

  it("keeps Skill tool result when activation declines to pivot (status-only skills)", async () => {
    const registry = new ToolRegistry(baseContext);
    registry.register(
      { name: "Skill", description: "skill", inputSchema: { type: "object", properties: {} } },
      async () => "workflow status listing",
    );

    const router = createMockRouter([
      {
        toolCalls: [{ id: "tu-skill", name: "Skill", input: { skill: "workflows" } }],
      },
      { text: "here is the status" },
    ]);
    const messages: LLMMessage[] = [{ role: "user", content: "check workflows" }];
    const starts: string[] = [];
    const ends: string[] = [];

    const result = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Skill"],
      model: "test-model",
      maxTurns: 5,
      onSkillActivate: async () => undefined,
      callbacks: {
        onToolStart: (name) => starts.push(name),
        onToolEnd: (name, status) => ends.push(`${name}:${status}`),
      },
    });

    expect(result).toBe("here is the status");
    expect(messages.some((m) => m.role === "tool" && m.content === "workflow status listing")).toBe(
      true,
    );
    // One Waiting lifecycle — double start left Activating stuck in the CLI.
    expect(starts).toEqual(["Skill"]);
    expect(ends).toEqual(["Skill:success"]);
  });

  it("follows Skill(dynamic-workflow) with harness Workflow launch tool result", async () => {
    const registry = new ToolRegistry(baseContext);
    registry.register(
      { name: "Skill", description: "skill", inputSchema: { type: "object", properties: {} } },
      async () => "Launching skill: deep-research",
    );

    const router = createMockRouter([
      {
        toolCalls: [
          {
            id: "tu-skill",
            name: "Skill",
            input: { skill: "deep-research", args: "refined research question" },
          },
        ],
      },
      { text: "research started in background" },
    ]);
    const messages: LLMMessage[] = [{ role: "user", content: "write a report" }];
    const starts: string[] = [];
    const ends: Array<{ name: string; output?: string }> = [];

    const result = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Skill", "Workflow"],
      model: "test-model",
      maxTurns: 5,
      onSkillActivate: async () => undefined,
      onSkillWorkflowFollowThrough: async ({ skillOutput }) => ({
        skillOutput,
        workflowToolCall: {
          id: "call_wf_synthetic",
          name: "Workflow",
          input: { name: "deep-research", args: "refined research question" },
        },
        workflowOutput:
          "Workflow launched in background.\nTask ID: wtest\nRun ID: wf_test\n\nYou will be notified when it completes. Use /workflows to watch live progress.",
      }),
      callbacks: {
        onToolStart: (name) => starts.push(name),
        onToolEnd: (name, _status, _err, output) => ends.push({ name, output }),
      },
    });

    expect(result).toBe("research started in background");
    expect(starts).toEqual(["Skill", "Workflow"]);
    expect(ends.map((e) => e.name)).toEqual(["Skill", "Workflow"]);
    expect(ends[0]?.output).toBe("Launching skill: deep-research");
    expect(ends[1]?.output).toContain("Workflow launched in background.");

    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0]).toMatchObject({
      name: "Skill",
      toolCallId: "tu-skill",
      content: "Launching skill: deep-research",
    });
    expect(toolMsgs[1]).toMatchObject({
      name: "Workflow",
      toolCallId: "call_wf_synthetic",
    });
    expect(String(toolMsgs[1]?.content)).toContain("Workflow launched in background.");

    const assistantWithTools = messages.find(
      (m) => m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length === 2,
    );
    expect(assistantWithTools?.toolCalls?.map((c) => c.name)).toEqual(["Skill", "Workflow"]);
  });

  it("does not abort the turn when onSkillActivate throws", async () => {
    const registry = new ToolRegistry(baseContext);
    registry.register(
      { name: "Skill", description: "skill", inputSchema: { type: "object", properties: {} } },
      async () => "tool body",
    );

    const router = createMockRouter([
      {
        toolCalls: [{ id: "tu-skill", name: "Skill", input: { skill: "workflows" } }],
      },
      { text: "recovered" },
    ]);
    const messages: LLMMessage[] = [{ role: "user", content: "hi" }];
    const starts: string[] = [];
    const ends: string[] = [];

    const result = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Skill"],
      model: "test-model",
      maxTurns: 5,
      onSkillActivate: async () => {
        throw new Error("Unknown skill: workflows");
      },
      callbacks: {
        onToolStart: (name) => starts.push(name),
        onToolEnd: (name, status) => ends.push(`${name}:${status}`),
      },
    });

    expect(result).toBe("recovered");
    expect(messages.some((m) => m.role === "tool" && m.content === "tool body")).toBe(true);
    expect(starts).toEqual(["Skill"]);
    expect(ends).toEqual(["Skill:success"]);
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

  it("allows Agent spawn when blockAgentTool is false (depth < 3)", async () => {
    const spawn = vi.fn(async () => "nested ok");
    const registry = echoRegistry();
    registry.register(agentToolDefinition, createAgentHandler({ spawnSubAgent: spawn }));

    const router = createMockRouter([
      {
        toolCalls: [
          {
            id: "tu-allowed",
            name: "Agent",
            input: { description: "nest ok", prompt: "go" },
          },
        ],
      },
      { text: "after nest" },
    ]);
    const messages: LLMMessage[] = [{ role: "user", content: "nest" }];

    const result = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Agent"],
      model: "test-model",
      maxTurns: 5,
      blockAgentTool: false,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result).toBe("after nest");
  });

  it("maps agentDepth gating: depth 2 allows Agent, depth 3 blocks", async () => {
    const { shouldBlockAgentToolAtDepth } = await import("./loop.js");
    expect(shouldBlockAgentToolAtDepth(0)).toBe(false);
    expect(shouldBlockAgentToolAtDepth(1)).toBe(false);
    expect(shouldBlockAgentToolAtDepth(2)).toBe(false);
    expect(shouldBlockAgentToolAtDepth(3)).toBe(true);
    expect(shouldBlockAgentToolAtDepth(4)).toBe(true);
  });

  it("runs consecutive Agent tool calls concurrently", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const releases: Array<() => void> = [];

    const spawn = vi.fn(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      concurrent -= 1;
      return "agent-done";
    });

    const registry = echoRegistry();
    registry.register(agentToolDefinition, createAgentHandler({ spawnSubAgent: spawn }));

    const router = createMockRouter([
      {
        toolCalls: [
          { id: "a1", name: "Agent", input: { description: "one", prompt: "p1" } },
          { id: "a2", name: "Agent", input: { description: "two", prompt: "p2" } },
        ],
      },
      { text: "both done" },
    ]);
    const messages: LLMMessage[] = [{ role: "user", content: "parallel" }];

    const loopPromise = runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Agent"],
      model: "test-model",
      maxTurns: 5,
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    expect(maxConcurrent).toBe(2);
    for (const release of releases) release();

    const result = await loopPromise;
    expect(result).toBe("both done");
    expect(messages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("keeps Agent clusters serial when interrupted by a non-Agent tool", async () => {
    const order: string[] = [];
    const spawn = vi.fn(async (input: { description: string }) => {
      order.push(`Agent:${input.description}`);
      return "ok";
    });
    const registry = new ToolRegistry(baseContext);
    registry.register(
      {
        name: "Echo",
        description: "echo",
        inputSchema: { type: "object", properties: { value: { type: "string" } } },
      },
      async (input) => {
        order.push(`Echo:${input.value}`);
        return `echo:${input.value}`;
      },
    );
    registry.register(agentToolDefinition, createAgentHandler({ spawnSubAgent: spawn }));

    const router = createMockRouter([
      {
        toolCalls: [
          { id: "a1", name: "Agent", input: { description: "first", prompt: "p1" } },
          { id: "e1", name: "Echo", input: { value: "mid" } },
          { id: "a2", name: "Agent", input: { description: "second", prompt: "p2" } },
        ],
      },
      { text: "serial" },
    ]);

    await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages: [{ role: "user", content: "cluster break" }],
      allowedTools: ["Agent", "Echo"],
      model: "test-model",
      maxTurns: 5,
    });

    expect(order).toEqual(["Agent:first", "Echo:mid", "Agent:second"]);
  });

  it("runs readonly tools concurrently with Agent in one cluster", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const releases: Array<() => void> = [];

    const hold = async (label: string) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      concurrent -= 1;
      return label;
    };

    const registry = new ToolRegistry(baseContext);
    registry.register(
      {
        name: "Peek",
        description: "readonly peek",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
        security: { readonly: true },
      },
      async (input) => hold(`peek:${input.id}`),
    );
    registry.register(
      agentToolDefinition,
      createAgentHandler({
        spawnSubAgent: async () => hold("agent"),
      }),
    );

    const router = createMockRouter([
      {
        toolCalls: [
          { id: "p1", name: "Peek", input: { id: "1" } },
          { id: "p2", name: "Peek", input: { id: "2" } },
          { id: "a1", name: "Agent", input: { description: "explore", prompt: "go" } },
        ],
      },
      { text: "cluster done" },
    ]);
    const messages: LLMMessage[] = [{ role: "user", content: "mix parallel" }];

    const loopPromise = runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Peek", "Agent"],
      model: "test-model",
      maxTurns: 5,
    });

    await vi.waitFor(() => expect(releases.length).toBe(3));
    expect(maxConcurrent).toBe(3);
    for (const release of releases) release();

    const result = await loopPromise;
    expect(result).toBe("cluster done");
    expect(messages.filter((m) => m.role === "tool")).toHaveLength(3);
  });

  it("does not overlap Write with neighboring Reads in the same loop", async () => {
    const order: string[] = [];
    const registry = new ToolRegistry(baseContext);
    registry.register(
      {
        name: "Peek",
        description: "readonly peek",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
        security: { readonly: true },
      },
      async (input) => {
        order.push(`start:Peek:${input.id}`);
        await new Promise((r) => setTimeout(r, 15));
        order.push(`end:Peek:${input.id}`);
        return `peek:${input.id}`;
      },
    );
    // Echo is neither readonly nor an async launcher → serial (same contract as Write).
    registry.register(
      {
        name: "Echo",
        description: "serial side-effect stand-in",
        inputSchema: { type: "object", properties: { value: { type: "string" } } },
      },
      async (input) => {
        order.push(`start:Echo:${input.value}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end:Echo:${input.value}`);
        return `echo:${input.value}`;
      },
    );

    const router = createMockRouter([
      {
        toolCalls: [
          { id: "r1", name: "Peek", input: { id: "1" } },
          { id: "e1", name: "Echo", input: { value: "x" } },
          { id: "r2", name: "Peek", input: { id: "2" } },
        ],
      },
      { text: "ordered" },
    ]);

    await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages: [{ role: "user", content: "serial write" }],
      allowedTools: ["Peek", "Echo"],
      model: "test-model",
      maxTurns: 5,
    });

    const serialStart = order.indexOf("start:Echo:x");
    const peek1End = order.indexOf("end:Peek:1");
    const peek2Start = order.indexOf("start:Peek:2");
    const serialEnd = order.indexOf("end:Echo:x");
    expect(serialStart).toBeGreaterThan(peek1End);
    expect(peek2Start).toBeGreaterThan(serialEnd);
  });

  it("appends tool results in tool_use order after a parallel cluster finishes out of order", async () => {
    const registry = new ToolRegistry(baseContext);
    registry.register(
      {
        name: "Peek",
        description: "readonly peek",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, delayMs: { type: "number" } },
        },
        security: { readonly: true },
      },
      async (input) => {
        await new Promise((r) => setTimeout(r, Number(input.delayMs ?? 0)));
        return `peek:${input.id}`;
      },
    );

    const router = createMockRouter([
      {
        toolCalls: [
          { id: "slow", name: "Peek", input: { id: "slow", delayMs: 40 } },
          { id: "fast", name: "Peek", input: { id: "fast", delayMs: 1 } },
        ],
      },
      { text: "ordered sink" },
    ]);
    const messages: LLMMessage[] = [{ role: "user", content: "order" }];

    await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["Peek"],
      model: "test-model",
      maxTurns: 5,
    });

    const tools = messages.filter((m) => m.role === "tool");
    expect(tools.map((m) => m.toolCallId)).toEqual(["slow", "fast"]);
    expect(tools.map((m) => m.content)).toEqual(["peek:slow", "peek:fast"]);
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
