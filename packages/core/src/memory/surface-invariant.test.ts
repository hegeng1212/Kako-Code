import { describe, expect, it } from "vitest";
import { buildMessages } from "../agent/context.js";
import { DEFAULT_BUILTIN_TOOL_NAMES, registerBuiltinTools } from "../tools/builtin/registry.js";
import { resolveAllToolNames } from "../tools/builtin/registry.js";
import { ToolRegistry } from "../tools/registry.js";
import { createMessage } from "./store.js";

describe("memory hardening surface invariant", () => {
  it("keeps MemorySearch/Get/Pin in default builtins", () => {
    expect(DEFAULT_BUILTIN_TOOL_NAMES).toContain("MemorySearch");
    expect(DEFAULT_BUILTIN_TOOL_NAMES).toContain("MemoryGet");
    expect(DEFAULT_BUILTIN_TOOL_NAMES).toContain("MemoryPin");
  });

  it("registerBuiltinTools exposes memory tools via resolveAllToolNames", () => {
    const registry = new ToolRegistry({
      cwd: "/tmp",
      sessionId: "s",
      agentId: "a",
    });
    registerBuiltinTools(registry);
    const names = resolveAllToolNames(registry);
    expect(names).toEqual(expect.arrayContaining(["MemorySearch", "MemoryGet", "MemoryPin", "Read"]));
  });

  it("buildMessages still injects skill catalog when provided", async () => {
    const messages = await buildMessages({
      definition: {
        name: "main",
        description: "t",
        model: "",
        systemPrompt: "You are Kako.",
      },
      transcript: [createMessage("user", "hi")],
      environment: {
        cwd: "/tmp",
        isGitRepository: false,
        platform: "darwin",
        shell: "/bin/zsh",
        model: "m",
      },
      availableSkills: {
        defaults: [
          {
            name: "demo-default",
            description: "default skill",
            location: "bundled",
            path: "/tmp/x",
          },
        ],
        user: [
          {
            name: "demo-user",
            description: "user skill",
            location: "user",
            path: "/tmp/y",
          },
        ],
      },
      sessionSummary: "L1 only",
      pinsSection: "## Session Pins\n\n- /tmp/a",
    });
    const system = String(messages[0]?.content ?? "");
    expect(system).toContain("You are Kako.");
    expect(system).toMatch(/skill/i);
    expect(system).toContain("Previous Session Summary");
    expect(system).toContain("Session Pins");
  });
});
