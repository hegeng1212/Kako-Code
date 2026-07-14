import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { SessionCapability } from "@kako/shared";
import type { ToolCall } from "@kako/shared";
import { ToolRegistry } from "../registry.js";
import { bashHandler, bashToolDefinition } from "./bash.js";
import { grepHandler, grepToolDefinition } from "./grep.js";
import { readHandler, readToolDefinition } from "./read.js";
import { writeHandler, writeToolDefinition } from "./write.js";
import { toolContext, withTempDir } from "./test-helpers.js";

function registryWith(
  cwd: string,
  opts?: {
    confirm?: (tc: ToolCall) => Promise<boolean>;
    permissionMode?: "plan" | "default";
    capability?: SessionCapability;
  },
): ToolRegistry {
  const registry = new ToolRegistry({
    cwd,
    sessionId: "sess-adv",
    agentId: "agent-adv",
    permissionMode: opts?.permissionMode,
    capability: opts?.capability,
    confirm: opts?.confirm,
  });
  registry.register(readToolDefinition, readHandler);
  registry.register(grepToolDefinition, grepHandler);
  registry.register(writeToolDefinition, writeHandler);
  registry.register(bashToolDefinition, bashHandler);
  return registry;
}

describe("ToolRegistry adversarial", () => {
  it("returns error for unknown tool", async () => {
    const registry = registryWith("/tmp");
    const result = await registry.execute({
      id: "tu-unknown",
      name: "NoSuchTool",
      input: {},
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Unknown tool");
  });

  it("denies when user rejects confirmation outside trusted scope", async () => {
    await withTempDir(async (dir) => {
      const confirm = vi.fn(async () => false);
      const registry = registryWith(dir, { confirm, capability: "WorkspaceWrite" });
      const outside = join(tmpdir(), `kako-deny-${Date.now()}.txt`);
      const result = await registry.execute({
        id: "tu-deny",
        name: "Write",
        input: { file_path: outside, content: "nope" },
      });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("denied");
    });
  });

  it("skips confirm for Write inside trusted session cwd with FullAccess", async () => {
    await withTempDir(async (dir) => {
      const confirm = vi.fn(async () => true);
      const registry = registryWith(dir, { confirm });
      const result = await registry.execute({
        id: "tu-auto",
        name: "Write",
        input: { file_path: join(dir, "x.txt"), content: "ok" },
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
    });
  });

  it("blocks Write in plan mode", async () => {
    await withTempDir(async (dir) => {
      const registry = registryWith(dir, { permissionMode: "plan" });
      const result = await registry.execute({
        id: "tu-plan",
        name: "Write",
        input: { file_path: join(dir, "x.txt"), content: "nope" },
      });
      expect(result.status).toBe("denied");
      expect(result.error).toContain("Plan mode");
    });
  });

  it("blocks Bash in plan mode", async () => {
    await withTempDir(async (dir) => {
      const registry = registryWith(dir, { permissionMode: "plan" });
      const result = await registry.execute({
        id: "tu-plan-bash",
        name: "Bash",
        input: { command: "echo hi" },
      });
      expect(result.status).toBe("denied");
    });
  });

  it("allows Grep in plan mode", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "sample.ts"), "export const PLAN = 1;\n", "utf-8");
      const registry = registryWith(dir, { permissionMode: "plan" });
      const result = await registry.execute({
        id: "tu-plan-grep",
        name: "Grep",
        input: { pattern: "PLAN", path: dir },
      });
      expect(result.status).toBe("success");
      expect(String(result.output)).toContain("PLAN");
    });
  });

  it("passes cwd into handler context", async () => {
    await withTempDir(async (dir) => {
      const registry = registryWith(dir);
      const spy = vi.fn(readHandler);
      registry.register(readToolDefinition, spy);

      await registry.execute({
        id: "tu-read",
        name: "Read",
        input: { path: "missing-for-spy" },
      });

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0]![1].cwd).toBe(dir);
    });
  });
});
