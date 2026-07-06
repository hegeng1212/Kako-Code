import type { McpToolInfo, SkillToolRef, SkillValidationResult } from "@kako/shared";
import { mcpToolName } from "@kako/shared";
import { DEFAULT_BUILTIN_TOOL_NAMES, getBuiltinTool } from "../tools/builtin/registry.js";

const BUILTIN_SET = new Set(DEFAULT_BUILTIN_TOOL_NAMES);

export function isBuiltinToolName(name: string): boolean {
  return BUILTIN_SET.has(name);
}

function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp/");
}

const IGNORE_TOOL_PATTERNS = [
  /^SKILL\.md$/i,
  /^kebab-case/i,
  /^markdown$/i,
  /^yaml$/i,
];

export function normalizeSkillToolName(raw: string): string {
  const trimmed = raw.trim().replace(/^['"`]|['"`]$/g, "");
  if (!trimmed) return trimmed;

  if (trimmed.startsWith("mcp/")) {
    return trimmed.replace(/\/+$/, "");
  }

  if (trimmed.startsWith("mcp__")) {
    const rest = trimmed.slice(5);
    const idx = rest.indexOf("__");
    if (idx > 0) {
      return mcpToolName(rest.slice(0, idx), rest.slice(idx + 2));
    }
  }

  if (BUILTIN_SET.has(trimmed)) return trimmed;

  return trimmed;
}

function shouldIgnoreTool(raw: string): boolean {
  return IGNORE_TOOL_PATTERNS.some((re) => re.test(raw.trim()));
}

function isLikelyToolReference(raw: string): boolean {
  const t = raw.trim();
  if (!t || shouldIgnoreTool(t)) return false;
  if (t.startsWith("mcp/") || t.startsWith("mcp__")) return true;
  if (BUILTIN_SET.has(t)) return true;
  if (/^调用/.test(t)) return false;
  return false;
}

export function extractToolReferences(skillMd: string): SkillToolRef[] {
  const body = skillMd.replace(/^---[\s\S]*?---\r?\n/, "");
  const found = new Map<string, SkillToolRef>();

  const add = (raw: string) => {
    const trimmed = raw.trim();
    if (!isLikelyToolReference(trimmed)) return;
    const normalized = normalizeSkillToolName(trimmed);
    if (!found.has(normalized)) {
      found.set(normalized, { raw: trimmed, normalized });
    }
  };

  for (const match of body.matchAll(/mcp__[\w-]+(?:__[\w-]+)+/g)) add(match[0]!);
  for (const match of body.matchAll(/mcp\/[\w./-]+/g)) add(match[0]!);
  for (const match of body.matchAll(
    /`(Read|Write|Edit|Bash|AskUserQuestion|Agent|CronCreate|CronDelete|CronList|Skill)`/g,
  )) {
    add(match[1]!);
  }
  for (const match of body.matchAll(/调用\s+[`'"]([^`'"]+)[`'"]\s*工具/g)) add(match[1]!);
  for (const match of body.matchAll(/(?:call|invoke|use)\s+[`'"]([^`'"]+)[`'"]/gi)) {
    add(match[1]!);
  }

  return [...found.values()];
}

export function resolvedMcpToolRefs(
  toolRefs: SkillToolRef[],
  missingTools: SkillToolRef[],
): SkillToolRef[] {
  const missing = new Set(missingTools.map((t) => t.normalized));
  return toolRefs.filter(
    (ref) => isMcpToolName(ref.normalized) && !missing.has(ref.normalized),
  );
}

export interface SkillToolCatalog {
  /** Built-in tools allowed on the main agent (name → schema). */
  agentBuiltins: Map<string, Record<string, unknown>>;
  /** All MCP tools currently synced (prefixed name → schema). */
  mcpTools: Map<string, Record<string, unknown>>;
}

export function buildSkillToolCatalog(
  agentToolNames: string[],
  mcpTools: McpToolInfo[],
): SkillToolCatalog {
  const agentBuiltins = new Map<string, Record<string, unknown>>();
  for (const name of agentToolNames) {
    if (name.startsWith("mcp/")) continue;
    const tool = getBuiltinTool(name);
    if (tool) {
      agentBuiltins.set(name, tool.definition.inputSchema as Record<string, unknown>);
    }
  }

  const mcp = new Map<string, Record<string, unknown>>();
  for (const info of mcpTools) {
    mcp.set(mcpToolName(info.serverId, info.name), info.inputSchema);
  }

  return { agentBuiltins, mcpTools: mcp };
}

export function validateSkillDependencies(
  skillMd: string,
  catalog: SkillToolCatalog,
): SkillValidationResult {
  const toolRefs = extractToolReferences(skillMd);
  const missingTools: SkillToolRef[] = [];
  const warnings: string[] = [];

  for (const ref of toolRefs) {
    const isMcp = isMcpToolName(ref.normalized);
    const isBuiltin = isBuiltinToolName(ref.normalized);

    if (isBuiltin) {
      continue;
    }

    const catalogHit = isMcp
      ? catalog.mcpTools.get(ref.normalized)
      : catalog.agentBuiltins.get(ref.normalized);

    if (!catalogHit) {
      missingTools.push(ref);
    }
  }

  const mcpMissing = missingTools.filter((ref) => isMcpToolName(ref.normalized));
  const resolvedMcpTools = resolvedMcpToolRefs(toolRefs, mcpMissing);

  if (mcpMissing.length > 0) {
    warnings.push(
      `技能引用了 ${mcpMissing.length} 个 MCP 工具，请先确认或连接对应 MCP 服务后再保存。`,
    );
  }

  const ok = mcpMissing.length === 0;

  return {
    ok,
    toolRefs,
    missingTools: mcpMissing,
    resolvedMcpTools,
    paramIssues: [],
    unavailableAgentTools: [],
    warnings,
  };
}
