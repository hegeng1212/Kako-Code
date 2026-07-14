import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_DESIGN_SYNC_DESCRIPTION,
  CLAUDE_DESIGN_SYNC_METHOD_DESCRIPTION,
} from "../claude-tool-text.js";

export const DESIGN_SYNC_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_DESIGN_SYNC_DESCRIPTION);

export const designSyncToolDefinition: ToolDefinition = {
  name: "DesignSync",
  description: DESIGN_SYNC_DESCRIPTION,
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    additionalProperties: true,
    properties: {
      method: {
        type: "string",
        description: CLAUDE_DESIGN_SYNC_METHOD_DESCRIPTION,
      },
      projectId: { type: "string" },
      planId: { type: "string" },
      name: { type: "string" },
      localDir: { type: "string" },
      path: { type: "string" },
      paths: { type: "array", items: { type: "string" } },
      files: { type: "array" },
      assets: { type: "array" },
    },
    required: ["method"],
  },
};

export function parseDesignSyncInput(raw: Record<string, unknown>): Record<string, unknown> {
  const method = typeof raw.method === "string" ? raw.method.trim() : "";
  if (!method) {
    throw new Error("DesignSync requires method");
  }
  return { ...raw, method };
}

export const designSyncHandler: ToolHandler = async (input) => {
  const payload = parseDesignSyncInput(input);
  throw new Error(
    `DesignSync is not available in Kako (method: ${String(payload.method)}). Claude Design / claude.ai/design integration is not wired in this harness.`,
  );
};
