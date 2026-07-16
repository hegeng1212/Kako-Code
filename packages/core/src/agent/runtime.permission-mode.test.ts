import { describe, expect, it } from "vitest";
import { AgentRuntime } from "./runtime.js";
import type { ProviderRegistry } from "../providers/registry.js";

describe("AgentRuntime session permission mode isolation", () => {
  it("stores plan/default modes independently per session", () => {
    const runtime = new AgentRuntime({
      registry: {} as ProviderRegistry,
      cwd: process.cwd(),
    });

    runtime.setSessionPermissionMode("sess-a", "plan", "/tmp/plans/a.md");
    runtime.setSessionPermissionMode("sess-b", "default");

    expect(runtime.getSessionPermissionMode("sess-a")).toBe("plan");
    expect(runtime.getSessionPermissionMode("sess-b")).toBe("default");

    runtime.setSessionPermissionMode("sess-a", "acceptEdits");
    expect(runtime.getSessionPermissionMode("sess-a")).toBe("acceptEdits");
    expect(runtime.getSessionPermissionMode("sess-b")).toBe("default");
  });

  it("defaults unknown sessions to default without affecting others", () => {
    const runtime = new AgentRuntime({
      registry: {} as ProviderRegistry,
      cwd: process.cwd(),
    });

    runtime.setSessionPermissionMode("sess-a", "bypassPermissions");
    expect(runtime.getSessionPermissionMode("sess-missing")).toBe("default");
    expect(runtime.getSessionPermissionMode("sess-a")).toBe("bypassPermissions");
  });
});
