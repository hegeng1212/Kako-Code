#!/usr/bin/env node
/**
 * Verify raw LLM stream for “反问我一个问题，让我可以选择”.
 * Shows whether the model returns tool_calls or plain text.
 *
 * Usage: node scripts/verify-ask-user-tool-calls.mjs
 */
import {
  createLLMRouter,
  initializeKakoHome,
  loadAgent,
  loadProviderRegistry,
  registerBuiltinTools,
  resolveAllowedToolNames,
  resolveModel,
} from "../packages/core/dist/index.js";
import { ToolRegistry } from "../packages/core/dist/index.js";
import { resolve } from "node:path";

const PROMPT = "反问我一个问题，让我可以选择";
const cwd = resolve(process.cwd());

await initializeKakoHome();

const registry = await loadProviderRegistry();
const router = createLLMRouter(registry);
const definition = await loadAgent("main", cwd);
const model = await resolveModel(definition.model, registry);

const toolRegistry = new ToolRegistry({
  cwd,
  sessionId: "verify-session",
  agentId: "agent-main",
});
registerBuiltinTools(toolRegistry);
const allowedTools = resolveAllowedToolNames(definition.tools, toolRegistry);
const tools = toolRegistry.toLLMTools(allowedTools);

console.log("Model:", model);
console.log("AskUserQuestion in tools:", allowedTools.includes("AskUserQuestion"));
console.log("Prompt:", PROMPT);
console.log("--- stream chunks ---\n");

const messages = [
  {
    role: "system",
    content:
      definition.systemPrompt.slice(0, 500) +
      "\n\nWhen user asks to choose, call AskUserQuestion tool.",
  },
  { role: "user", content: PROMPT },
];

let textParts = "";
let reasoningParts = "";
const toolCalls = new Map();
const chunkLog = [];

for await (const chunk of router.stream({ model, messages, tools })) {
  if (chunk.type === "text_delta" && chunk.text) {
    textParts += chunk.text;
    chunkLog.push({ type: "text_delta", preview: chunk.text.slice(0, 80) });
  }
  if (chunk.type === "reasoning_delta" && chunk.text) {
    reasoningParts += chunk.text;
    chunkLog.push({ type: "reasoning_delta", len: chunk.text.length });
  }
  if (chunk.type === "tool_call_delta" && chunk.toolCall?.id) {
    const id = chunk.toolCall.id;
    const existing = toolCalls.get(id) ?? {
      id,
      name: chunk.toolCall.name ?? "",
      input: {},
    };
    if (chunk.toolCall.name) existing.name = chunk.toolCall.name;
    if (chunk.toolCall.input && Object.keys(chunk.toolCall.input).length > 0) {
      existing.input = chunk.toolCall.input;
    }
    toolCalls.set(id, existing);
    const keys = Object.keys(chunk.toolCall.input ?? {});
    chunkLog.push({
      type: "tool_call_delta",
      id,
      name: existing.name,
      inputKeys: keys,
      hasQuestions: Boolean((chunk.toolCall.input)?.questions),
    });
  }
}

console.log("Chunk summary:");
for (const c of chunkLog) {
  console.log(" ", JSON.stringify(c));
}

console.log("\n=== VERDICT ===");
console.log("text_delta chars:", textParts.length);
console.log("reasoning chars:", reasoningParts.length);
console.log("tool_calls count:", toolCalls.size);

if (toolCalls.size === 0) {
  console.log("result: TEXT ONLY (no tool_calls)");
  if (textParts.trim()) {
    console.log("text preview:", textParts.trim().slice(0, 200));
  }
  process.exit(1);
}

for (const tc of toolCalls.values()) {
  console.log("\ntool_call:");
  console.log("  id:", tc.id);
  console.log("  name:", tc.name);
  console.log("  input keys:", Object.keys(tc.input));
  if (tc.input.questions) {
    const q = tc.input.questions[0];
    console.log("  question:", q?.question);
    console.log(
      "  options:",
      q?.options?.map((o) => o.label).join(" / "),
    );
  } else {
    console.log("  input:", JSON.stringify(tc.input).slice(0, 300));
  }
}

const askUser = [...toolCalls.values()].find((t) => t.name === "AskUserQuestion");
if (askUser?.input?.questions?.length) {
  console.log("\nPASS: model returned AskUserQuestion tool_calls with options");
  process.exit(0);
}

console.log("\nPARTIAL: tool_calls present but not AskUserQuestion with questions");
process.exit(1);
