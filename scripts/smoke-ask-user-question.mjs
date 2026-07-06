#!/usr/bin/env node
/**
 * Smoke test: real LLM should call AskUserQuestion for “反问我一个问题，让我可以选择”.
 * Usage: node scripts/smoke-ask-user-question.mjs
 */
import { createHarness, initializeKakoHome } from "../packages/core/dist/index.js";
import { resolve } from "node:path";

const cwd = resolve(process.cwd());

await initializeKakoHome();

let toolCalled = false;
let toolInput = null;
let toolResult = null;

const harness = await createHarness({
  cwd,
  askUserQuestion: async (input) => {
    toolCalled = true;
    toolInput = input;
    console.log("\n=== AskUserQuestion TRIGGERED ===");
    console.log("header:", input.questions[0]?.header);
    console.log("question:", input.questions[0]?.question);
    console.log(
      "options:",
      input.questions[0]?.options.map((o) => o.label).join(" / "),
    );
    const q = input.questions[0];
    const result = {
      answers: { [q.question]: "编程相关需求" },
    };
    toolResult = result;
    return result;
  },
  onReasoningDelta: (text) => process.stderr.write(text),
  onTextDelta: (text) => process.stdout.write(text),
});

const session = await harness.runtime.createSession();
console.log("Sending: 反问我一个问题，让我可以选择\n");

const { response } = await harness.runtime.runTurn(
  session,
  "反问我一个问题，让我可以选择",
);

console.log("\n\n=== RESULT ===");
console.log("toolCalled:", toolCalled);
console.log("response length:", response.length);
console.log("response preview:", response.slice(0, 200));

if (!toolCalled) {
  console.error("\nFAIL: Model did not call AskUserQuestion");
  process.exit(1);
}

if (!toolInput?.questions?.[0]?.options?.length) {
  console.error("\nFAIL: Tool input missing questions/options");
  process.exit(1);
}

console.log("\nPASS: AskUserQuestion flow triggered with valid options");
await harness.runtime.endSession(session);
