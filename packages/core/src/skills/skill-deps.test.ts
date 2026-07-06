import { describe, expect, it } from "vitest";
import {
  buildSkillToolCatalog,
  extractToolReferences,
  normalizeSkillToolName,
  resolvedMcpToolRefs,
  validateSkillDependencies,
} from "./skill-deps.js";
import type { McpToolInfo } from "@kako/shared";

const BABY_SKILL = `---
name: baby-growth-tracker
description: 记录宝宝生长数据
---

# 宝宝生长数据记录

### 1. 获取宝宝列表
调用 \`mcp__bbt_mcp__bbt_pregnancy_find_baby\` 工具，无需参数。

### 3. 保存记录
调用 \`mcp__bbt_mcp__bbt_tool_record_baby_height\` 工具保存记录，参数：
- \`baby_id\`: 宝宝ID
- \`height\`: 身高（厘米）
- \`weight\`: 体重（千克）
- \`head_circumference\`: 头围（厘米）
- \`date\`: 记录日期
`;

describe("normalizeSkillToolName", () => {
  it("converts Cursor-style MCP names to kako format", () => {
    expect(normalizeSkillToolName("mcp__bbt_mcp__bbt_pregnancy_find_baby")).toBe(
      "mcp/bbt_mcp/bbt_pregnancy_find_baby",
    );
  });
});

describe("extractToolReferences", () => {
  it("extracts MCP tools from baby growth skill", () => {
    const refs = extractToolReferences(BABY_SKILL);
    expect(refs.map((r) => r.normalized)).toEqual([
      "mcp/bbt_mcp/bbt_pregnancy_find_baby",
      "mcp/bbt_mcp/bbt_tool_record_baby_height",
    ]);
  });
});

describe("validateSkillDependencies", () => {
  const mcpTools: McpToolInfo[] = [
    {
      serverId: "bbt_mcp",
      serverName: "BBT MCP",
      name: "bbt_pregnancy_find_baby",
      description: "find baby",
      inputSchema: { type: "object", properties: {} },
    },
    {
      serverId: "bbt_mcp",
      serverName: "BBT MCP",
      name: "bbt_tool_record_baby_height",
      description: "record height",
      inputSchema: {
        type: "object",
        required: ["baby_id", "date"],
        properties: {
          baby_id: { type: "string" },
          height: { type: "number" },
          weight: { type: "number" },
          head_circumference: { type: "number" },
          date: { type: "string" },
        },
      },
    },
  ];

  it("passes when MCP tools exist regardless of param docs", () => {
    const catalog = buildSkillToolCatalog(["Read", "AskUserQuestion"], mcpTools);
    const result = validateSkillDependencies(BABY_SKILL, catalog);
    expect(result.ok).toBe(true);
    expect(result.missingTools).toEqual([]);
    expect(result.paramIssues).toEqual([]);
    expect(result.resolvedMcpTools).toHaveLength(2);
  });

  it("ignores builtin tools — no confirmation or blocking", () => {
    const skillMd = "Use `Read` to read files, `Write` to save, and `Bash` to run commands.";
    const catalog = buildSkillToolCatalog([], []);
    const result = validateSkillDependencies(skillMd, catalog);
    expect(result.ok).toBe(true);
    expect(result.missingTools).toEqual([]);
    expect(result.resolvedMcpTools).toEqual([]);
  });

  it("fails when MCP tools are missing", () => {
    const catalog = buildSkillToolCatalog(["Read"], []);
    const result = validateSkillDependencies(BABY_SKILL, catalog);
    expect(result.ok).toBe(false);
    expect(result.missingTools).toHaveLength(2);
    expect(result.resolvedMcpTools).toEqual([]);
  });

  it("lists resolved MCP tools separately from missing ones", () => {
    const skill = "调用 `mcp/babytree/known_tool` 和 `mcp/babytree/missing_tool`";
    const catalog = buildSkillToolCatalog([], [
      {
        serverId: "babytree",
        serverName: "Babytree",
        name: "known_tool",
        description: "ok",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    const result = validateSkillDependencies(skill, catalog);
    expect(result.ok).toBe(false);
    expect(result.resolvedMcpTools).toEqual([
      { raw: "mcp/babytree/known_tool", normalized: "mcp/babytree/known_tool" },
    ]);
    expect(resolvedMcpToolRefs(result.toolRefs, result.missingTools)).toEqual(
      result.resolvedMcpTools,
    );
  });
});
