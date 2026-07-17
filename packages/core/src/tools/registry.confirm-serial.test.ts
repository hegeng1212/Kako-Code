import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerBuiltinTools } from "./builtin/registry.js";
import { ToolRegistry } from "./registry.js";

describe("ToolRegistry confirm serialization", () => {
  it("serializes concurrent confirm callbacks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kako-confirm-serial-"));
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];

    const confirm = vi.fn(async (toolCall: { id: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(`start:${toolCall.id}`);
      await new Promise((r) => setTimeout(r, 30));
      order.push(`end:${toolCall.id}`);
      inFlight -= 1;
      return { allowed: true };
    });

    const registry = new ToolRegistry({
      cwd: dir,
      sessionId: "sess-serial",
      agentId: "agent-1",
      confirm,
    });
    registry.register(
      {
        name: "RiskyPeek",
        description: "needs confirm",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
        security: { sideEffect: true, defaultRiskLevel: "high" },
      },
      async (input) => `ok:${input.id}`,
    );

    const [a, b] = await Promise.all([
      registry.execute({ id: "tu-a", name: "RiskyPeek", input: { id: "a" } }),
      registry.execute({ id: "tu-b", name: "RiskyPeek", input: { id: "b" } }),
    ]);

    expect(a.status).toBe("success");
    expect(b.status).toBe("success");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
    // Whichever tool wins the lock first, its confirm must fully end before the other starts.
    expect(order).toHaveLength(4);
    expect(order[0]).toMatch(/^start:/);
    expect(order[1]).toBe(order[0]!.replace("start:", "end:"));
    expect(order[2]).toMatch(/^start:/);
    expect(order[3]).toBe(order[2]!.replace("start:", "end:"));
    expect(order[0]).not.toBe(order[2]);
  });

  it("skips sibling confirm after workspace-path session allow (re-gate under lock)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kako-confirm-ws-cwd-"));
    const outside = await mkdtemp(join(tmpdir(), "kako-confirm-ws-out-"));
    await mkdir(outside, { recursive: true });
    const fileA = join(outside, "a.go");
    const fileB = join(outside, "b.go");
    await writeFile(fileA, "package a\n", "utf8");
    await writeFile(fileB, "package b\n", "utf8");

    const confirm = vi.fn(async () => ({
      allowed: true,
      sessionAllow: "workspace-path" as const,
      workspacePath: resolve(outside),
    }));

    const registry = new ToolRegistry({
      cwd,
      sessionId: "sess-ws",
      agentId: "agent-1",
      capability: "FullAccess",
      confirm,
    });
    registerBuiltinTools(registry);

    const [a, b] = await Promise.all([
      registry.execute({ id: "tu-a", name: "Read", input: { file_path: fileA } }),
      registry.execute({ id: "tu-b", name: "Read", input: { file_path: fileB } }),
    ]);

    expect(a.status).toBe("success");
    expect(b.status).toBe("success");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("still confirms the second tool after the first is denied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kako-confirm-deny-"));
    let calls = 0;
    const confirm = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { allowed: false, denialReason: "nope" };
      }
      return { allowed: true };
    });

    const registry = new ToolRegistry({
      cwd: dir,
      sessionId: "sess-deny",
      agentId: "agent-1",
      confirm,
    });
    registry.register(
      {
        name: "RiskyPeek",
        description: "needs confirm",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
        security: { sideEffect: true, defaultRiskLevel: "high" },
      },
      async (input) => `ok:${input.id}`,
    );

    const [a, b] = await Promise.all([
      registry.execute({ id: "tu-a", name: "RiskyPeek", input: { id: "a" } }),
      registry.execute({ id: "tu-b", name: "RiskyPeek", input: { id: "b" } }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["denied", "success"]);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
