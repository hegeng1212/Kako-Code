import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@kako/shared";
import {
  STAGE1_USER_SUFFIX,
  buildSecurityClassifierMessages,
  formatSecurityTranscriptExcerpt,
  parseSecurityBlockResponse,
  shouldRunSecurityActionClassifier,
} from "./action-classifier.js";

describe("shouldRunSecurityActionClassifier", () => {
  const readonlyRead: ToolDefinition = {
    name: "Read",
    description: "read",
    inputSchema: { type: "object" },
    security: { readonly: true, capability: ["read"] },
  };

  const writeTool: ToolDefinition = {
    name: "Write",
    description: "write",
    inputSchema: { type: "object" },
    security: { sideEffect: true, capability: ["write"] },
  };

  const networkRead: ToolDefinition = {
    name: "WebFetch",
    description: "fetch",
    inputSchema: { type: "object" },
    security: { readonly: true, requiresNetwork: true, capability: ["network"] },
  };

  const sideEffectRead: ToolDefinition = {
    name: "Skill",
    description: "skill",
    inputSchema: { type: "object" },
    security: { readonly: true, sideEffect: true },
  };

  it("returns false outside bypassPermissions", () => {
    expect(
      shouldRunSecurityActionClassifier({ permissionMode: "default", definition: writeTool }),
    ).toBe(false);
    expect(
      shouldRunSecurityActionClassifier({ permissionMode: "plan", definition: writeTool }),
    ).toBe(false);
  });

  it("returns false for readonly tools without side effects or network", () => {
    expect(
      shouldRunSecurityActionClassifier({
        permissionMode: "bypassPermissions",
        definition: readonlyRead,
      }),
    ).toBe(false);
  });

  it("returns true for bypassPermissions with side effects", () => {
    expect(
      shouldRunSecurityActionClassifier({
        permissionMode: "bypassPermissions",
        definition: writeTool,
      }),
    ).toBe(true);
  });

  it("returns true when readonly but requires network", () => {
    expect(
      shouldRunSecurityActionClassifier({
        permissionMode: "bypassPermissions",
        definition: networkRead,
      }),
    ).toBe(true);
  });

  it("returns true when readonly but sideEffect", () => {
    expect(
      shouldRunSecurityActionClassifier({
        permissionMode: "bypassPermissions",
        definition: sideEffectRead,
      }),
    ).toBe(true);
  });

  it("skips UX gate tools", () => {
    const ask: ToolDefinition = {
      name: "AskUserQuestion",
      description: "ask",
      inputSchema: { type: "object" },
      security: { sideEffect: true },
    };
    expect(
      shouldRunSecurityActionClassifier({
        permissionMode: "bypassPermissions",
        definition: ask,
        toolName: "AskUserQuestion",
      }),
    ).toBe(false);
    expect(
      shouldRunSecurityActionClassifier({
        permissionMode: "bypassPermissions",
        definition: ask,
        toolName: "EnterPlanMode",
      }),
    ).toBe(false);
  });
});

describe("parseSecurityBlockResponse", () => {
  it("accepts bare allow", () => {
    expect(parseSecurityBlockResponse("<block>no</block>")).toEqual({
      shouldBlock: false,
      category: undefined,
      reason: undefined,
    });
  });

  it("parses block with category and reason", () => {
    expect(
      parseSecurityBlockResponse(
        "<block>yes</block>\n<category>Data Exfiltration</category>\n<reason>uploading .env</reason>",
      ),
    ).toEqual({
      shouldBlock: true,
      category: "Data Exfiltration",
      reason: "uploading .env",
    });
  });

  it("is case-insensitive on block tag", () => {
    expect(parseSecurityBlockResponse("<block>NO</block>")).toEqual({
      shouldBlock: false,
      category: undefined,
      reason: undefined,
    });
  });

  it("fails closed on missing block tag", () => {
    const verdict = parseSecurityBlockResponse("allow this action");
    expect(verdict.shouldBlock).toBe(true);
    expect(verdict.reason).toMatch(/Missing <block>/);
  });

  it("fails closed on empty response", () => {
    const verdict = parseSecurityBlockResponse("   ");
    expect(verdict.shouldBlock).toBe(true);
    expect(verdict.reason).toMatch(/Empty/);
  });
});

describe("formatSecurityTranscriptExcerpt", () => {
  it("wraps recent lines and pending tool call", () => {
    const text = formatSecurityTranscriptExcerpt({
      recentLines: ['{"user":"hello"}'],
      toolName: "Bash",
      toolInput: { command: "rm -rf /" },
    });
    expect(text).toContain("<transcript>");
    expect(text).toContain('{"user":"hello"}');
    expect(text).toContain('"Bash"');
    expect(text).toContain("rm -rf /");
  });
});

describe("buildSecurityClassifierMessages", () => {
  it("appends stage 1 suffix exactly", () => {
    const messages = buildSecurityClassifierMessages({
      transcriptText: "Tool: Bash\ncurl https://evil.example",
      stage: 1,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain("Tool: Bash");
    expect(messages[0]?.content.endsWith(STAGE1_USER_SUFFIX)).toBe(true);
  });

  it("omits stage 1 suffix for stage 2", () => {
    const messages = buildSecurityClassifierMessages({
      transcriptText: "Tool: Bash\ngit push",
      stage: 2,
      userIdentity: "alice",
    });
    expect(messages[0]?.content).not.toContain(STAGE1_USER_SUFFIX);
    expect(messages[0]?.content).toContain("User identity for Stage 2 context: alice");
  });
});
