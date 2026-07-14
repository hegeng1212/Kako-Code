import type { ToolDefinition, ToolHandler } from "@kako/shared";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_PUSH_NOTIFICATION_DESCRIPTION,
  CLAUDE_PUSH_NOTIFICATION_MESSAGE_DESCRIPTION,
} from "../claude-tool-text.js";

export const PUSH_NOTIFICATION_DESCRIPTION = adaptClaudeCodeToolText(
  CLAUDE_PUSH_NOTIFICATION_DESCRIPTION,
);

export const pushNotificationToolDefinition: ToolDefinition = {
  name: "PushNotification",
  description: PUSH_NOTIFICATION_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      message: {
        type: "string",
        description: CLAUDE_PUSH_NOTIFICATION_MESSAGE_DESCRIPTION,
      },
    },
    required: ["message"],
  },
};

export function parsePushNotificationInput(raw: Record<string, unknown>): string {
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (!message) {
    throw new Error("PushNotification requires message");
  }
  if (message.length > 200) {
    throw new Error("PushNotification message must be under 200 characters");
  }
  return message;
}

export const pushNotificationHandler: ToolHandler = async (input) => {
  const message = parsePushNotificationInput(input);
  return JSON.stringify({
    sent: false,
    message,
    reason:
      "Not sent — user active at terminal (Kako has no Remote Control mobile push channel yet). Your chat output already reaches the user.",
  });
};
