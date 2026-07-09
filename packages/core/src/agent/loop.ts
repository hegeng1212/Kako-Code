import type { LLMMessage, LLMTokenUsage, ToolCall } from "@kako/shared";
import type { LLMRouter } from "@kako/shared";
import { mergeToolCallInput } from "./merge-tool-input.js";
import { getTextContent } from "../llm/content-blocks.js";
import { toolOutputToLlmContent } from "../media/read-media.js";
import { createMessage, type FileMemoryStore } from "../memory/store.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolLogger } from "../observability/tool-logger.js";

export class TurnAbortedError extends Error {
  constructor() {
    super("Turn aborted");
    this.name = "TurnAbortedError";
  }
}

export interface AgentLoopCallbacks {
  onTextDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  /** Reasoning stream finished for this model completion (before answer/tools). */
  onReasoningEnd?: () => void;
  onStreamUsage?: (usage: LLMTokenUsage) => void;
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, status: string, error?: string, output?: string, input?: Record<string, unknown>) => void;
  /** Undo streamed answer chars (e.g. user Esc on choice picker or Ctrl+C). */
  onAnswerRollback?: (charCount: number) => void;
}

export interface SkillActivateInput {
  toolCall: ToolCall;
  priorMessages: LLMMessage[];
}

export interface RunAgentLoopOptions {
  router: LLMRouter;
  registry: ToolRegistry;
  toolLogger: ToolLogger;
  memory?: FileMemoryStore;
  messages: LLMMessage[];
  allowedTools: string[];
  model: string;
  maxTurns: number;
  callbacks?: AgentLoopCallbacks;
  /** Block nested Agent tool calls (sub-agents). */
  blockAgentTool?: boolean;
  /** When true, abort streaming and end the turn (e.g. Ctrl+C during generation). */
  shouldAbort?: () => boolean;
  /** Rebuild messages after a lone Skill tool call (harness loads skill + pivots context). */
  onSkillActivate?: (input: SkillActivateInput) => Promise<LLMMessage[] | null | void> | LLMMessage[] | null | void;
}

export async function streamCompletion(
  router: LLMRouter,
  request: Parameters<LLMRouter["stream"]>[0],
  handlers: {
    onText: (text: string) => void;
    onReasoning?: (text: string) => void;
    onReasoningEnd?: () => void;
    onUsage?: (usage: LLMTokenUsage) => void;
  },
  shouldAbort?: () => boolean,
): Promise<ToolCall[]> {
  const abortController = new AbortController();
  const toolCalls = new Map<string, ToolCall>();
  let reasoningOpen = false;

  const endReasoningIfOpen = (): void => {
    if (!reasoningOpen) return;
    reasoningOpen = false;
    handlers.onReasoningEnd?.();
  };

  const abortTurn = (): never => {
    abortController.abort();
    throw new TurnAbortedError();
  };

  try {
    for await (const chunk of router.stream({ ...request, signal: abortController.signal })) {
      if (shouldAbort?.()) {
        abortTurn();
      }
      if (chunk.type === "reasoning_delta" && chunk.text) {
        reasoningOpen = true;
        handlers.onReasoning?.(chunk.text);
      }
      if (chunk.type === "text_delta" && chunk.text) {
        endReasoningIfOpen();
        handlers.onText(chunk.text);
      }
      if (chunk.type === "done" && chunk.usage) {
        handlers.onUsage?.(chunk.usage);
      }
      if (chunk.type === "tool_call_delta" && chunk.toolCall?.id) {
        endReasoningIfOpen();
        const existing = toolCalls.get(chunk.toolCall.id) ?? {
          id: chunk.toolCall.id,
          name: chunk.toolCall.name ?? "",
          input: {},
        };
        if (chunk.toolCall.name) existing.name = chunk.toolCall.name;
        const incoming = chunk.toolCall.input;
        if (incoming && typeof incoming === "object" && Object.keys(incoming).length > 0) {
          existing.input = mergeToolCallInput(existing.input, incoming);
        }
        toolCalls.set(chunk.toolCall.id, existing);
      }
      if (chunk.type === "error") {
        throw new Error(chunk.error ?? "LLM stream error");
      }
    }
  } catch (error) {
    if (error instanceof TurnAbortedError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new TurnAbortedError();
    }
    throw error;
  } finally {
    endReasoningIfOpen();
    abortController.abort();
  }

  return [...toolCalls.values()];
}

function askUserQuestionOutputDeclined(output: string): boolean {
  try {
    const parsed = JSON.parse(output) as {
      declined?: boolean;
      answers?: Record<string, string>;
    };
    if (parsed.declined !== true) return false;
    return Object.keys(parsed.answers ?? {}).length === 0;
  } catch {
    return false;
  }
}

function rollbackResponse(
  responseText: string,
  callbacks?: AgentLoopCallbacks,
): string {
  if (responseText.length > 0) {
    callbacks?.onAnswerRollback?.(responseText.length);
  }
  return "";
}

async function persistAssistantTurn(
  memory: FileMemoryStore | undefined,
  content: string,
  toolCalls: ToolCall[],
): Promise<void> {
  if (!memory || (!content && !toolCalls.length)) return;
  await memory.append(
    createMessage("assistant", content, toolCalls.length ? { toolCalls } : undefined),
  );
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<string> {
  const {
    router,
    registry,
    toolLogger,
    memory,
    messages,
    allowedTools,
    model,
    maxTurns,
    callbacks,
    blockAgentTool = false,
    shouldAbort,
    onSkillActivate,
  } = options;

  let responseText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    if (shouldAbort?.()) {
      return rollbackResponse(responseText, callbacks);
    }

    let toolCalls: ToolCall[];
    try {
      toolCalls = await streamCompletion(
        router,
        { model, messages, tools: registry.toLLMTools(allowedTools, { messages }) },
        {
          onText: (text) => {
            responseText += text;
            callbacks?.onTextDelta?.(text);
          },
          onReasoning: (text) => {
            callbacks?.onReasoningDelta?.(text);
          },
          onReasoningEnd: () => {
            callbacks?.onReasoningEnd?.();
          },
          onUsage: (usage) => {
            callbacks?.onStreamUsage?.(usage);
          },
        },
        shouldAbort,
      );
    } catch (err) {
      if (err instanceof TurnAbortedError) {
        return rollbackResponse(responseText, callbacks);
      }
      throw err;
    }

    if (!toolCalls.length) {
      break;
    }

    const loneSkillCall =
      toolCalls.length === 1 ? toolCalls[0] : undefined;
    const skillPivot =
      loneSkillCall?.name === "Skill" && onSkillActivate;

    if (skillPivot && loneSkillCall) {
      const toolCall = loneSkillCall;
      const streamedBeforePivot = responseText.length;
      const result = await registry.execute(toolCall);
      await toolLogger.log(result);

      if (result.status === "success") {
        const pivoted = await onSkillActivate({
          toolCall,
          priorMessages: [...messages],
        });
        if (pivoted?.length) {
          if (streamedBeforePivot > 0) {
            callbacks?.onAnswerRollback?.(streamedBeforePivot);
          }
          messages.length = 0;
          messages.push(...pivoted);
          responseText = "";
          continue;
        }
      }

      callbacks?.onToolStart?.(toolCall.name, toolCall.input);
      callbacks?.onToolEnd?.(
        toolCall.name,
        result.status,
        result.error,
        result.status === "success" ? String(result.output ?? "") : undefined,
        toolCall.input,
      );

      messages.push({ role: "assistant", content: responseText, toolCalls });
      await persistAssistantTurn(memory, responseText, toolCalls);
      const llmOutput =
        result.status === "success"
          ? toolOutputToLlmContent(result.output)
          : `Error: ${result.error ?? result.status}`;
      messages.push({
        role: "tool",
        content: llmOutput,
        toolCallId: toolCall.id,
        name: toolCall.name,
      });
      if (memory) {
        await memory.append(
          createMessage("tool", getTextContent(llmOutput), {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
          }),
        );
      }
      responseText = "";
      continue;
    }

    messages.push({ role: "assistant", content: responseText, toolCalls });
    await persistAssistantTurn(memory, responseText, toolCalls);

    let choiceDeclined = false;

    for (const toolCall of toolCalls) {
      if (blockAgentTool && toolCall.name === "Agent") {
        const output = "Error: Sub-agents cannot spawn nested Agent tools";
        messages.push({
          role: "tool",
          content: output,
          toolCallId: toolCall.id,
          name: toolCall.name,
        });
        if (memory) {
          await memory.append(
            createMessage("tool", output, {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
            }),
          );
        }
        continue;
      }

      callbacks?.onToolStart?.(toolCall.name, toolCall.input);
      const result = await registry.execute(toolCall);
      await toolLogger.log(result);
      callbacks?.onToolEnd?.(
        toolCall.name,
        result.status,
        result.error,
        result.status === "success" ? String(result.output ?? "") : undefined,
        toolCall.input,
      );

      const llmOutput =
        result.status === "success"
          ? toolOutputToLlmContent(result.output)
          : `Error: ${result.error ?? result.status}`;

      messages.push({
        role: "tool",
        content: llmOutput,
        toolCallId: toolCall.id,
        name: toolCall.name,
      });

      if (memory) {
        await memory.append(
          createMessage("tool", getTextContent(llmOutput), {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
          }),
        );
      }

      if (toolCall.name === "AskUserQuestion" && askUserQuestionOutputDeclined(getTextContent(llmOutput))) {
        choiceDeclined = true;
      }
    }

    if (choiceDeclined) {
      responseText = rollbackResponse(responseText, callbacks);
      break;
    }

    responseText = "";
  }

  return responseText;
}
