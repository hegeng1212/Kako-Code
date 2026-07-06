import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskUserQuestionInput } from "@kako/shared";
import { runAgentLoop } from "./loop.js";
import { createMockRouter } from "./test/mock-router.js";
import { FileMemoryStore, createMessage } from "../memory/store.js";
import { ToolLogger } from "../observability/tool-logger.js";
import { ToolRegistry } from "../tools/registry.js";
import { registerBuiltinTools } from "../tools/builtin/registry.js";
import { buildMessages, resolveEnvironmentInfo } from "./context.js";
import { loadAgent } from "./loader.js";

describe("multi-tool agent turn (AskUserQuestion → Bash → Read)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      const { rm } = await import("node:fs/promises");
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("runs the full tool chain within one turn and persists replayable transcript", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    tempDir = await mkdtemp(join(tmpdir(), "kako-tool-chain-"));
    const sessionId = `sess-tool-chain-${Date.now()}`;

    const knowledgeDir = join(tempDir, "knowledge", "product", "alpha");
    await mkdir(knowledgeDir, { recursive: true });
    await writeFile(
      join(knowledgeDir, "overview.md"),
      "# Overview\n\nProduct: Sample App\n",
      "utf-8",
    );

    const askInput: AskUserQuestionInput = {
      questions: [
        {
          header: "Scope",
          question: "Which area should we focus on?",
          multiSelect: false,
          options: [
            { label: "Area A", description: "First area" },
            { label: "Area B", description: "Second area" },
          ],
        },
        {
          header: "Output",
          question: "What deliverable do you need?",
          multiSelect: false,
          options: [
            { label: "Design doc", description: "Design" },
            { label: "Summary", description: "Summary" },
          ],
        },
      ],
    };

    const askUserQuestion = vi.fn(async () => ({
      answers: {
        "Which area should we focus on?": "Area A",
        "What deliverable do you need?": "Design doc",
      },
    }));

    const registry = new ToolRegistry({
      cwd: tempDir,
      sessionId,
      agentId: "agent-main",
      askUserQuestion,
      confirm: async () => true,
    });
    registerBuiltinTools(registry);

    const overviewPath = join(knowledgeDir, "overview.md");
    const router = createMockRouter([
      {
        toolCalls: [
          {
            id: "call-ask",
            name: "AskUserQuestion",
            input: askInput as unknown as Record<string, unknown>,
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "call-bash",
            name: "Bash",
            input: {
              command: `ls -la ${join(tempDir, "knowledge", "product")}`,
              description: "List product knowledge directory",
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "call-read",
            name: "Read",
            input: { file_path: overviewPath },
          },
        ],
      },
      { text: "Read the overview and started the design doc." },
    ]);

    const memory = new FileMemoryStore(sessionId);
    await memory.append(createMessage("user", "Help me plan a new feature"));

    const definition = await loadAgent("main", tempDir);
    const environment = await resolveEnvironmentInfo(tempDir, "test-model");
    const messages = await buildMessages({
      definition,
      transcript: await memory.loadTranscript(),
      environment,
    });

    const response = await runAgentLoop({
      router,
      registry,
      toolLogger: new ToolLogger(),
      memory,
      messages,
      allowedTools: ["AskUserQuestion", "Bash", "Read"],
      model: "mock",
      maxTurns: 10,
    });

    expect(askUserQuestion).toHaveBeenCalledTimes(1);
    expect(response).toContain("design");

    const transcript = await memory.loadTranscript();
    const askTool = transcript.find((m) => m.toolName === "AskUserQuestion");
    expect(askTool?.content).toContain("Your questions have been answered");
    expect(askTool?.content).toContain("Area A");

    const bashTool = transcript.find((m) => m.toolName === "Bash");
    expect(bashTool?.content).toContain("alpha");

    const readTool = transcript.find((m) => m.toolName === "Read");
    expect(readTool?.content).toContain("Sample App");

    const assistantWithTools = transcript.filter((m) => m.role === "assistant" && m.toolCalls?.length);
    expect(assistantWithTools.length).toBeGreaterThanOrEqual(3);

    // Next user turn must rebuild valid OpenAI-style tool history
    await memory.append(createMessage("user", "Continue refining"));
    const nextMessages = await buildMessages({
      definition,
      transcript: await memory.loadTranscript(),
      environment,
    });

    const toolIdx = nextMessages.findIndex((m) => m.role === "tool" && m.name === "AskUserQuestion");
    expect(toolIdx).toBeGreaterThan(0);
    const priorAssistant = nextMessages[toolIdx - 1];
    expect(priorAssistant?.role).toBe("assistant");
    expect(priorAssistant?.toolCalls?.some((tc) => tc.name === "AskUserQuestion")).toBe(true);
  });
});
