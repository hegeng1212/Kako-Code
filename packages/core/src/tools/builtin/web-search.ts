import type { ToolDefinition, ToolHandler } from "@kako/shared";
import {
  formatCurrentMonthYear,
  resolveWebSearchTimeZone,
} from "../../locale/user-timezone.js";
import { parseWebSearchInput, runWebSearch } from "../../web/web-search.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_WEB_SEARCH_ALLOWED_DOMAINS_DESCRIPTION,
  CLAUDE_WEB_SEARCH_BLOCKED_DOMAINS_DESCRIPTION,
  CLAUDE_WEB_SEARCH_DESCRIPTION,
  CLAUDE_WEB_SEARCH_QUERY_DESCRIPTION,
} from "../claude-tool-text.js";

export function buildWebSearchDescription(userText?: string): string {
  const timeZone = resolveWebSearchTimeZone(userText);
  const monthYear = formatCurrentMonthYear(timeZone);
  return adaptClaudeCodeToolText(
    CLAUDE_WEB_SEARCH_DESCRIPTION.replace("{{CURRENT_MONTH_YEAR}}", monthYear),
  );
}

export const WEB_SEARCH_DESCRIPTION = buildWebSearchDescription();

export const webSearchToolDefinition: ToolDefinition = {
  name: "WebSearch",
  description: WEB_SEARCH_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: CLAUDE_WEB_SEARCH_QUERY_DESCRIPTION,
      },
      allowed_domains: {
        type: "array",
        items: { type: "string" },
        description: CLAUDE_WEB_SEARCH_ALLOWED_DOMAINS_DESCRIPTION,
      },
      blocked_domains: {
        type: "array",
        items: { type: "string" },
        description: CLAUDE_WEB_SEARCH_BLOCKED_DOMAINS_DESCRIPTION,
      },
    },
    required: ["query"],
  },
};

export const webSearchHandler: ToolHandler = async (input) => {
  const parsed = parseWebSearchInput(input);
  return runWebSearch(parsed);
};
