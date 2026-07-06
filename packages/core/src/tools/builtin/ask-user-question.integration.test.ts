import { describe, expect, it, vi } from "vitest";
import type { AskUserQuestionInput, ToolExecutionContext } from "@kako/shared";
import { runAgentLoop } from "../../agent/loop.js";
import { createMockRouter } from "../../agent/test/mock-router.js";
import { ToolLogger } from "../../observability/tool-logger.js";
import { ToolRegistry } from "../registry.js";
import { registerBuiltinTools } from "./registry.js";
import {
  askUserQuestionToolDefinition,
  formatAskUserQuestionResult,
  parseAskUserQuestionInput,
} from "./ask-user-question.js";

const execContext: ToolExecutionContext = {
  agentId: "agent-main",
  sessionId: "sess-int",
  toolUseId: "tu-int",
  cwd: "/tmp",
};

import { sampleDirectionQuestion } from "./ask-user-question.fixtures.js";

describe("AskUserQuestion integration (agent loop)", () => {
  function registryWithPrompt(
    prompt: (input: AskUserQuestionInput) => Promise<{ answers: Record<string, string>; declined?: boolean }>,
  ): ToolRegistry {
    const registry = new ToolRegistry({
      ...execContext,
      askUserQuestion: prompt,
    });
    registerBuiltinTools(registry);
    return registry;
  }

  it("model tool call → user selects → result fed back → model continues", async () => {
    const askUserQuestion = vi.fn(async () => ({
      answers: { "Which option should we use?": "Option A" },
    }));

    const registry = registryWithPrompt(askUserQuestion);
    const router = createMockRouter([
      {
        toolCalls: [
          {
            id: "tu-q1",
            name: "AskUserQuestion",
            input: sampleDirectionQuestion as unknown as Record<string, unknown>,
          },
        ],
      },
      { text: "Proceeding with Option A." },
    ]);

    const messages = [{ role: "user" as const, content: "Help me choose an approach" }];
    const response = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["AskUserQuestion"],
      model: "mock",
      maxTurns: 5,
    });

    expect(askUserQuestion).toHaveBeenCalledTimes(1);
    expect(askUserQuestion.mock.calls[0]![0]).toEqual(sampleDirectionQuestion);

    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("Your questions have been answered");
    expect(toolMsg?.content).toContain("Option A");

    expect(response).toContain("Option A");
    expect(router.callCount()).toBe(2);
  });

  it("model tool call → user Esc → cancelled JSON fed back → loop stops", async () => {
    const askUserQuestion = vi.fn(async () => ({
      answers: {},
      declined: true,
    }));

    const registry = registryWithPrompt(askUserQuestion);
    const router = createMockRouter([
      {
        toolCalls: [
          {
            id: "tu-q2",
            name: "AskUserQuestion",
            input: sampleDirectionQuestion as unknown as Record<string, unknown>,
          },
        ],
      },
      { text: "should not run after Esc" },
    ]);

    const messages = [{ role: "user" as const, content: "Ask me to choose" }];
    const response = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      messages,
      allowedTools: ["AskUserQuestion"],
      model: "mock",
      maxTurns: 5,
    });

    expect(router.callCount()).toBe(1);
    expect(response).toBe("");

    const toolMsg = messages.find((m) => m.role === "tool");
    const parsed = JSON.parse(toolMsg!.content as string) as {
      declined: boolean;
      message: string;
    };
    expect(parsed.declined).toBe(true);
    expect(parsed.message).toContain("cancelled");
  });

  it("validates sample model payload before prompting", () => {
    const parsed = parseAskUserQuestionInput(
      sampleDirectionQuestion as unknown as Record<string, unknown>,
    );
    expect(parsed.questions[0]!.header).toBe("Choice");
    expect(parsed.questions[0]!.options).toHaveLength(3);
  });

  it("AskUserQuestion is registered in default builtins", () => {
    const registry = new ToolRegistry(execContext);
    registerBuiltinTools(registry);
    expect(registry.getDefinitions().some((d) => d.name === "AskUserQuestion")).toBe(true);
    const tool = registry.toLLMTools(["AskUserQuestion"])[0];
    const desc = tool?.description ?? "";
    expect(desc).toContain("blocked on a decision");
    expect(desc).toContain("EnterPlanMode");
    const schema = tool?.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema?.required).toEqual(["questions"]);
    expect(schema?.properties).toHaveProperty("answers");
    expect(schema?.properties).toHaveProperty("annotations");
    expect(schema?.properties).toHaveProperty("metadata");
    expect(schema?.properties).toHaveProperty("questions");
  });

  it("formats declined result for the model", () => {
    const json = formatAskUserQuestionResult({ answers: {}, declined: true });
    expect(JSON.parse(json)).toMatchObject({
      declined: true,
      message: expect.stringContaining("cancelled"),
    });
  });
});
