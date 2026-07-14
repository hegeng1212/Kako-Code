import { describe, expect, it } from "vitest";
import { pushNotificationToolDefinition } from "./push-notification.js";

describe("PushNotification tool definition", () => {
  it("preserves Claude Code description and message schema", () => {
    expect(pushNotificationToolDefinition.description).toContain("desktop notification");
    expect(pushNotificationToolDefinition.description).toContain("200 characters");
    expect(pushNotificationToolDefinition.inputSchema.required).toEqual(["message"]);
  });
});
