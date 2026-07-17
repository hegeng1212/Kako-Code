import type { LLMMessage, LLMTokenUsage, ToolCall } from "@kako/shared";
import type { LLMRouter } from "@kako/shared";
import { mergeToolCallInput } from "./merge-tool-input.js";
import { normalizeToolCall } from "../tools/normalize-tool-input.js";
import { getTextContent } from "../llm/content-blocks.js";
import { toolOutputToLlmContent } from "../media/read-media.js";
import { createMessage, type FileMemoryStore } from "../memory/store.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolLogger } from "../observability/tool-logger.js";
import { partitionToolCallClusters } from "./tool-parallel.js";

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

/** Claude-parity follow-through: Skill ack + harness-launched Workflow tool result. */
export interface SkillWorkflowFollowThrough {
  skillOutput: string;
  workflowToolCall: ToolCall;
  workflowOutput: string;
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
  /** Block nested Agent tool calls (sub-agents at depth ≥ 3). */
  blockAgentTool?: boolean;
  /** When true, abort streaming and end the turn (e.g. Ctrl+C during generation). */
  shouldAbort?: () => boolean;
  /** Rebuild messages after a lone Skill tool call (harness loads skill + pivots context). */
  onSkillActivate?: (input: SkillActivateInput) => Promise<LLMMessage[] | null | void> | LLMMessage[] | null | void;
  /**
   * After lone Skill when pivot declines: optionally launch a Workflow locally and
   * continue with Skill + Workflow tool results (dynamic-workflow skills).
   */
  onSkillWorkflowFollowThrough?: (
    input: SkillActivateInput & { skillOutput: string },
  ) => Promise<SkillWorkflowFollowThrough | null | void> | SkillWorkflowFollowThrough | null | void;
}

/** Main = 0; at depth ≥ 3, Agent tool is blocked. Depths 0/1/2 may spawn. */
export function shouldBlockAgentToolAtDepth(agentDepth: number): boolean {
  return agentDepth >= 3;
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

  const throwIfAborted = (): void => {
    if (shouldAbort?.()) {
      abortTurn();
    }
  };

  try {
    throwIfAborted();
    const iterator = router.stream({ ...request, signal: abortController.signal })[Symbol.asyncIterator]();

    while (true) {
      const next = await nextStreamChunk(iterator, shouldAbort, abortController);
      if (next.done) break;
      const chunk = next.value;
      throwIfAborted();
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

  return [...toolCalls.values()].map(normalizeToolCall);
}

const ABORT_POLL_MS = 25;

async function nextStreamChunk<T>(
  iterator: AsyncIterator<T>,
  shouldAbort?: () => boolean,
  abortController?: AbortController,
): Promise<IteratorResult<T>> {
  if (!shouldAbort) {
    return iterator.next();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      fn();
    };
    const poll = setInterval(() => {
      if (!shouldAbort()) return;
      abortController?.abort();
      finish(() => reject(new TurnAbortedError()));
    }, ABORT_POLL_MS);
    iterator.next().then(
      (result) => finish(() => resolve(result)),
      (err) => finish(() => reject(err)),
    );
  });
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
    onSkillWorkflowFollowThrough,
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
      loneSkillCall?.name === "Skill" &&
      Boolean(onSkillActivate || onSkillWorkflowFollowThrough);

    if (skillPivot && loneSkillCall) {
      const toolCall = loneSkillCall;
      const streamedBeforePivot = responseText.length;
      const result = await registry.execute(toolCall);
      await toolLogger.log(result);

      // Exactly one start/end pair — a second start left "Waiting. Activating…" stuck.
      callbacks?.onToolStart?.(toolCall.name, toolCall.input);

        if (result.status === "success") {
        let pivoted: LLMMessage[] | null | void = undefined;
        if (onSkillActivate) {
          try {
            pivoted = await onSkillActivate({
              toolCall,
              priorMessages: [...messages],
            });
          } catch {
            // Failed activation must not kill the turn — keep Skill tool result in-band.
            pivoted = undefined;
          }
        }
        if (pivoted?.length) {
          callbacks?.onToolEnd?.(
            toolCall.name,
            "success",
            undefined,
            String(result.output ?? ""),
            toolCall.input,
          );
          if (streamedBeforePivot > 0) {
            callbacks?.onAnswerRollback?.(streamedBeforePivot);
          }
          messages.length = 0;
          messages.push(...pivoted);
          responseText = "";
          continue;
        }

        // dynamic-workflow: Skill ack + harness-local Workflow launch, then continue
        // with a Workflow tool result (Claude parity — do not bury launch under Skill).
        if (onSkillWorkflowFollowThrough) {
          let follow: SkillWorkflowFollowThrough | null | void;
          try {
            follow = await onSkillWorkflowFollowThrough({
              toolCall,
              priorMessages: [...messages],
              skillOutput: String(result.output ?? ""),
            });
          } catch {
            follow = undefined;
          }
          if (follow?.workflowToolCall && follow.workflowOutput) {
            const skillOutput = follow.skillOutput || String(result.output ?? "");
            callbacks?.onToolEnd?.(
              toolCall.name,
              "success",
              undefined,
              skillOutput,
              toolCall.input,
            );
            callbacks?.onToolStart?.(
              follow.workflowToolCall.name,
              follow.workflowToolCall.input,
            );
            callbacks?.onToolEnd?.(
              follow.workflowToolCall.name,
              "success",
              undefined,
              follow.workflowOutput,
              follow.workflowToolCall.input,
            );

            const pairedCalls = [toolCall, follow.workflowToolCall];
            messages.push({ role: "assistant", content: responseText, toolCalls: pairedCalls });
            await persistAssistantTurn(memory, responseText, pairedCalls);

            const skillLlm = toolOutputToLlmContent(skillOutput);
            messages.push({
              role: "tool",
              content: skillLlm,
              toolCallId: toolCall.id,
              name: toolCall.name,
            });
            const workflowLlm = toolOutputToLlmContent(follow.workflowOutput);
            messages.push({
              role: "tool",
              content: workflowLlm,
              toolCallId: follow.workflowToolCall.id,
              name: follow.workflowToolCall.name,
            });
            if (memory) {
              await memory.append(
                createMessage("tool", getTextContent(skillLlm), {
                  toolCallId: toolCall.id,
                  toolName: toolCall.name,
                }),
              );
              await memory.append(
                createMessage("tool", getTextContent(workflowLlm), {
                  toolCallId: follow.workflowToolCall.id,
                  toolName: follow.workflowToolCall.name,
                }),
              );
            }
            responseText = "";
            continue;
          }
        }
      }

      // Status-only skill (e.g. workflows) or failed execute: keep tool result in-band.
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

    const executeOneTool = async (
      toolCall: ToolCall,
    ): Promise<{ declined: boolean }> => {
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
        return { declined: false };
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

      return {
        declined:
          toolCall.name === "AskUserQuestion" &&
          askUserQuestionOutputDeclined(getTextContent(llmOutput)),
      };
    };

    /** Run parallelizable tools concurrently; push results in cluster order after all finish. */
    const executeParallelCluster = async (cluster: ToolCall[]): Promise<void> => {
      type ClusterItem = {
        toolCall: ToolCall;
        llmOutput: ReturnType<typeof toolOutputToLlmContent> | string;
        declined: boolean;
      };

      const items = await Promise.all(
        cluster.map(async (toolCall): Promise<ClusterItem> => {
          if (blockAgentTool && toolCall.name === "Agent") {
            return {
              toolCall,
              llmOutput: "Error: Sub-agents cannot spawn nested Agent tools",
              declined: false,
            };
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

          return {
            toolCall,
            llmOutput,
            declined:
              toolCall.name === "AskUserQuestion" &&
              askUserQuestionOutputDeclined(getTextContent(llmOutput)),
          };
        }),
      );

      for (const item of items) {
        messages.push({
          role: "tool",
          content: item.llmOutput,
          toolCallId: item.toolCall.id,
          name: item.toolCall.name,
        });
        if (memory) {
          await memory.append(
            createMessage("tool", getTextContent(item.llmOutput), {
              toolCallId: item.toolCall.id,
              toolName: item.toolCall.name,
            }),
          );
        }
        if (item.declined) choiceDeclined = true;
      }
    };

    const parts = partitionToolCallClusters(toolCalls, (name) =>
      registry.getDefinitions([name])[0],
    );

    for (const part of parts) {
      if (shouldAbort?.()) {
        return rollbackResponse(responseText, callbacks);
      }
      const cluster = part.indices.map((idx) => toolCalls[idx]!);
      if (part.parallel && cluster.length > 1) {
        await executeParallelCluster(cluster);
      } else {
        if ((await executeOneTool(cluster[0]!)).declined) {
          choiceDeclined = true;
        }
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
