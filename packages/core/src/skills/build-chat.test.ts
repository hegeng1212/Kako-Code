import { describe, expect, it } from "vitest";
import {
  buildToolConfirmationQuestions,
  extractSkillMdFromText,
  formatToolCatalogForPrompt,
  messagesForSkillBuildLlm,
  parseSkillBuildUserChoice,
  questionsForSkillBuildTurn,
  summarizeMcpInputSchema,
  splitAssistantBuildResponse,
} from "./build-chat.js";
import { validateSkillDependencies, buildSkillToolCatalog } from "./skill-deps.js";
import type { McpToolInfo } from "@kako/shared";

describe("summarizeMcpInputSchema", () => {
  it("marks required vs optional params", () => {
    expect(
      summarizeMcpInputSchema({
        type: "object",
        required: ["baby_id", "weight"],
        properties: {
          baby_id: { type: "string" },
          weight: { type: "number" },
          note: { type: "string" },
        },
      }),
    ).toContain("`baby_id` (required)");
    expect(
      summarizeMcpInputSchema({
        type: "object",
        required: ["baby_id", "weight"],
        properties: {
          baby_id: { type: "string" },
          weight: { type: "number" },
          note: { type: "string" },
        },
      }),
    ).toContain("`note` (optional)");
  });
});

describe("formatToolCatalogForPrompt", () => {
  it("includes required markers in MCP tool listing", () => {
    const text = formatToolCatalogForPrompt(buildSkillToolCatalog([], [
      {
        serverId: "babytree",
        serverName: "Babytree",
        name: "bbt_tool.record_baby_height",
        description: "record height",
        inputSchema: {
          type: "object",
          required: ["baby_id", "weight"],
          properties: { baby_id: { type: "string" }, weight: { type: "number" } },
        },
      },
    ]), [
      {
        serverId: "babytree",
        serverName: "Babytree",
        name: "bbt_tool.record_baby_height",
        description: "record height",
        inputSchema: {
          type: "object",
          required: ["baby_id", "weight"],
          properties: { baby_id: { type: "string" }, weight: { type: "number" } },
        },
      },
    ]);
    expect(text).toContain("`baby_id` (required)");
    expect(text).toContain("`weight` (required)");
  });
});

describe("splitAssistantBuildResponse", () => {
  it("extracts skill md and keeps prose as message", () => {
    const text = `好的，我先整理一版草稿。

---
name: demo
description: demo skill
---

# Demo
`;
    const result = splitAssistantBuildResponse(text);
    expect(result.skillMd).toContain("name: demo");
    expect(result.assistantMessage).toContain("草稿");
    expect(result.assistantMessage).not.toContain("```");
  });
});

describe("parseSkillBuildUserChoice", () => {
  it("parses choice with question id", () => {
    expect(parseSkillBuildUserChoice("我选择：是的，我会去连接并同步该 MCP｜question=tool-1")).toEqual({
      label: "是的，我会去连接并同步该 MCP",
      questionId: "tool-1",
    });
  });
});

describe("messagesForSkillBuildLlm", () => {
  it("keeps only the latest user message for the LLM", () => {
    expect(
      messagesForSkillBuildLlm([
        { role: "user", content: "做一个宝宝技能" },
        { role: "assistant", content: "需要哪些工具？" },
        { role: "user", content: "用 bbt 记录身高" },
      ]),
    ).toEqual([{ role: "user", content: "用 bbt 记录身高" }]);
  });
});

describe("questionsForSkillBuildTurn", () => {
  it("returns no questions when validation passed", () => {
    const questions = questionsForSkillBuildTurn(
      {
        ok: true,
        toolRefs: [{ raw: "mcp/a/b", normalized: "mcp/a/b" }],
        missingTools: [],
        resolvedMcpTools: [{ raw: "mcp/a/b", normalized: "mcp/a/b" }],
        unavailableAgentTools: [],
        warnings: [],
        paramIssues: [],
      },
      [],
    );
    expect(questions).toEqual([]);
  });
});

describe("buildToolConfirmationQuestions", () => {
  it("asks user to confirm missing MCP tool", () => {
    const skillMd = "调用 `mcp__bbt_mcp__bbt_pregnancy_find_baby` 工具";
    const catalog = buildSkillToolCatalog(["Read"], []);
    const validation = validateSkillDependencies(skillMd, catalog);
    const questions = buildToolConfirmationQuestions(validation, []);
    expect(questions.some((q) => q.kind === "tool_missing")).toBe(true);
    expect(questions[0]?.text).toContain("bbt_mcp");
  });

  it("does not ask about missing required params", () => {
    const skill = `调用 \`mcp/babytree/bbt_tool.record_baby_height\` 工具`;
    const catalog = buildSkillToolCatalog(["Read"], [
      {
        serverId: "babytree",
        serverName: "Babytree",
        name: "bbt_tool.record_baby_height",
        description: "record",
        inputSchema: {
          type: "object",
          required: ["baby_id", "weight"],
          properties: {
            baby_id: { type: "string" },
            weight: { type: "number" },
          },
        },
      },
    ] satisfies McpToolInfo[]);
    const validation = validateSkillDependencies(skill, catalog);
    expect(validation.ok).toBe(true);
    expect(validation.paramIssues).toEqual([]);
    expect(validation.resolvedMcpTools).toHaveLength(1);
    expect(buildToolConfirmationQuestions(validation, [])).toEqual([]);
  });
});

describe("extractSkillMdFromText", () => {
  it("parses fenced skill md", () => {
    const md = extractSkillMdFromText("```markdown\n---\nname: x\n---\n\n# X\n```");
    expect(md).toContain("name: x");
  });
});
