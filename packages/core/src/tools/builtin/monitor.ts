import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_MONITOR_DESCRIPTION } from "../claude-tool-text.js";

export const MONITOR_DEFAULT_TIMEOUT_MS = 300_000;
export const MONITOR_MAX_TIMEOUT_MS = 3_600_000;
export const MONITOR_MIN_TIMEOUT_MS = 1_000;

const MONITOR_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_MONITOR_DESCRIPTION);

export const monitorToolDefinition: ToolDefinition = {
  name: "Monitor",
  description: MONITOR_DESCRIPTION,
  requiresConfirmation: true,
  sandbox: { timeoutMs: MONITOR_DEFAULT_TIMEOUT_MS },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      command: {
        type: "string",
        description: "Shell command or script. Each stdout line is an event; exit ends the watch.",
      },
      description: {
        type: "string",
        description: "Short human-readable description of what you are monitoring (shown in notifications).",
      },
      persistent: {
        type: "boolean",
        default: false,
        description:
          "Run for the lifetime of the session (no timeout). Use for session-length watches like PR monitoring or log tails. Stop with TaskStop.",
      },
      timeout_ms: {
        type: "number",
        default: MONITOR_DEFAULT_TIMEOUT_MS,
        minimum: MONITOR_MIN_TIMEOUT_MS,
        description:
          "Kill the monitor after this deadline. Default 300000ms, max 3600000ms. Ignored when persistent is true.",
      },
    },
    required: ["description", "timeout_ms", "persistent", "command"],
  },
};

export interface MonitorInput {
  command: string;
  description: string;
  persistent: boolean;
  timeoutMs: number;
}

export function parseMonitorInput(input: Record<string, unknown>): MonitorInput {
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!command) {
    throw new Error("Monitor requires command");
  }

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) {
    throw new Error("Monitor requires description");
  }

  const persistent = input.persistent === true;

  const rawTimeout = input.timeout_ms ?? MONITOR_DEFAULT_TIMEOUT_MS;
  const timeoutN = Number(rawTimeout);
  let timeoutMs = MONITOR_DEFAULT_TIMEOUT_MS;
  if (Number.isFinite(timeoutN) && timeoutN >= MONITOR_MIN_TIMEOUT_MS) {
    timeoutMs = Math.min(Math.floor(timeoutN), MONITOR_MAX_TIMEOUT_MS);
  }

  return { command, description, persistent, timeoutMs };
}

export function assertMonitorSupported(): void {
  throw new Error("Background monitors are not supported yet");
}

export const monitorHandler: ToolHandler = async (input) => {
  parseMonitorInput(input);
  assertMonitorSupported();
};
