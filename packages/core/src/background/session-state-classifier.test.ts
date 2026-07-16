import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildClassifierUserMessage,
  parseClassifierResponse,
} from "./session-state-classifier.js";

const CLASSIFIER_PROMPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../agents/prompts/session-state-classifier.md",
);

describe("buildClassifierUserMessage", () => {
  it("formats duration from previousState.since in minutes", () => {
    const since = new Date(Date.now() - 26 * 60 * 1000).toISOString();
    const message = buildClassifierUserMessage({
      previousState: {
        state: "working",
        detail: "running tests",
        tempo: "active",
        since,
      },
      userAsk: "fix the bug",
      assistantTail: "I'll continue monitoring CI.",
      toolSummary: "Bash×2, Read",
    });
    expect(message).toMatch(/^Current state: working \(for 26m\)/);
    expect(message).toContain('Tool calls so far: Bash×2, Read');
    expect(message).toContain('User\'s most recent ask: "fix the bug"');
    expect(message).toContain("Assistant message tail");
  });

  it("formats duration in seconds when under one minute", () => {
    const since = new Date(Date.now() - 45 * 1000).toISOString();
    const message = buildClassifierUserMessage({
      previousState: {
        state: "done",
        detail: "shipped fix",
        tempo: "idle",
        since,
      },
      userAsk: "thanks",
      assistantTail: "Done.",
      toolSummary: "",
    });
    expect(message).toMatch(/^Current state: done \(for 45s\)/);
    expect(message).toContain("Tool calls so far: none");
  });

  it("omits duration when since is invalid", () => {
    const message = buildClassifierUserMessage({
      previousState: {
        state: "blocked",
        detail: "needs key",
        tempo: "blocked",
        since: "not-a-date",
      },
      userAsk: "continue",
      assistantTail: "Waiting.",
      toolSummary: "AskUserQuestion",
    });
    expect(message).toMatch(/^Current state: blocked$/m);
  });

  it("uses none when no previous state", () => {
    const message = buildClassifierUserMessage({
      userAsk: "hello",
      assistantTail: "Hi.",
      toolSummary: "",
    });
    expect(message).toMatch(/^Current state: \(none\)/);
  });

  it("keeps assistant tail to last ~1000 chars", () => {
    const tail = "x".repeat(1500);
    const message = buildClassifierUserMessage({
      userAsk: "q",
      assistantTail: tail,
      toolSummary: "",
    });
    const tailSection = message.split("Assistant message tail")[1] ?? "";
    expect(tailSection.trim().length).toBeLessThanOrEqual(1000 + 20);
    expect(tailSection).toContain("x".repeat(100));
    expect(tailSection).not.toContain("x".repeat(1500));
  });
});

describe("session-state-classifier system prompt", () => {
  it("covers the four states and hard boundaries", async () => {
    const text = await readFile(CLASSIFIER_PROMPT, "utf-8");
    expect(text).toMatch(/The four states/i);
    expect(text).toContain("`working`");
    expect(text).toContain("`blocked`");
    expect(text).toContain("API / AUTH");
    expect(text).toContain("optional-offer");
  });
});

describe("parseClassifierResponse", () => {
  it("parses valid JSON", () => {
    const parsed = parseClassifierResponse(
      JSON.stringify({
        state: "done",
        detail: "fixed login",
        tempo: "idle",
        output: { result: "login redirect fixed" },
      }),
    );
    expect(parsed).toEqual({
      state: "done",
      detail: "fixed login",
      tempo: "idle",
      needs: undefined,
      result: "login redirect fixed",
    });
  });

  it("parses fenced JSON", () => {
    const parsed = parseClassifierResponse(
      '```json\n{"state":"blocked","detail":"needs API key","tempo":"blocked","needs":"set OPENAI_API_KEY"}\n```',
    );
    expect(parsed?.state).toBe("blocked");
    expect(parsed?.needs).toBe("set OPENAI_API_KEY");
    expect(parsed?.tempo).toBe("blocked");
  });

  it("returns null for invalid state", () => {
    expect(parseClassifierResponse('{"state":"paused","detail":"x","tempo":"idle"}')).toBeNull();
  });
});
