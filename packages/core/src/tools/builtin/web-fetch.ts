import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { parseWebFetchInput, runWebFetch } from "../../web/web-fetch.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_WEB_FETCH_DESCRIPTION,
  CLAUDE_WEB_FETCH_PROMPT_DESCRIPTION,
  CLAUDE_WEB_FETCH_URL_DESCRIPTION,
} from "../claude-tool-text.js";

export const WEB_FETCH_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_WEB_FETCH_DESCRIPTION);

export const webFetchToolDefinition: ToolDefinition = {
  name: "WebFetch",
  description: WEB_FETCH_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        description: CLAUDE_WEB_FETCH_URL_DESCRIPTION,
      },
      prompt: {
        type: "string",
        description: CLAUDE_WEB_FETCH_PROMPT_DESCRIPTION,
      },
    },
    required: ["url", "prompt"],
  },
};

export const webFetchHandler: ToolHandler = async (input) => {
  const parsed = parseWebFetchInput(input);
  return runWebFetch(parsed);
};
