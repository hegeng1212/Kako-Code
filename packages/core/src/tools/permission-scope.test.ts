import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@kako/shared";
import {
  isPathWithinTrustedRoots,
  isToolCallInTrustedScope,
} from "./permission-scope.js";
import { ToolRegistry } from "./registry.js";
import { writeHandler, writeToolDefinition } from "./builtin/write.js";

describe("isPathWithinTrustedRoots", () => {
  it("accepts paths inside a root", () => {
    const root = "/tmp/project";
    expect(isPathWithinTrustedRoots("/tmp/project/src/a.ts", [root])).toBe(true);
    expect(isPathWithinTrustedRoots("/tmp/project", [root])).toBe(true);
  });

  it("rejects paths outside a root", () => {
    expect(isPathWithinTrustedRoots("/etc/passwd", ["/tmp/project"])).toBe(false);
  });
});

describe("isToolCallInTrustedScope", () => {
  const cwd = "/Users/me/workspace";

  it("allows Write to absolute paths under cwd", () => {
    expect(
      isToolCallInTrustedScope(
        {
          id: "1",
          name: "Write",
          input: { file_path: "/Users/me/workspace/out.txt", content: "x" },
        },
        cwd,
      ),
    ).toBe(true);
  });

  it("allows Write with legacy path alias under cwd", () => {
    expect(
      isToolCallInTrustedScope(
        { id: "1", name: "Write", input: { path: "src/a.ts", contents: "x" } },
        cwd,
      ),
    ).toBe(true);
  });

  it("blocks Write outside cwd and kako home", () => {
    expect(
      isToolCallInTrustedScope(
        { id: "1", name: "Write", input: { path: "/tmp/out.txt", contents: "x" } },
        cwd,
      ),
    ).toBe(false);
  });

  it("allows Bash when working directory stays in cwd", () => {
    expect(
      isToolCallInTrustedScope(
        { id: "1", name: "Bash", input: { command: "ls" } },
        cwd,
      ),
    ).toBe(true);
  });
});

describe("ToolRegistry trusted scope", () => {
  let tempDir = "";
  let kakoHome = "";
  const prevKakoHome = process.env.KAKO_HOME;

  afterEach(async () => {
    process.env.KAKO_HOME = prevKakoHome;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    if (kakoHome) await rm(kakoHome, { recursive: true, force: true });
  });

  it("skips confirm for Write inside session cwd with FullAccess", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-scope-cwd-"));
    const confirm = vi.fn(async () => false);
    const registry = new ToolRegistry({
      cwd: tempDir,
      sessionId: "sess",
      agentId: "agent",
      capability: "FullAccess",
      confirm,
    });
    registry.register(writeToolDefinition, writeHandler);

    const result = await registry.execute({
      id: "tu-write",
      name: "Write",
      input: { file_path: join(tempDir, "notes.txt"), content: "hello" },
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("skips confirm for low-risk Bash inside session cwd", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-scope-cwd-"));
    const confirm = vi.fn(async () => false);
    const registry = new ToolRegistry({
      cwd: tempDir,
      sessionId: "sess",
      agentId: "agent",
      confirm,
    });
    const { bashHandler, bashToolDefinition } = await import("./builtin/bash.js");
    registry.register(bashToolDefinition, bashHandler);

    const result = await registry.execute({
      id: "tu-bash",
      name: "Bash",
      input: { command: "ls -la" },
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("still confirms high-risk Bash with FullAccess", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-scope-bash-full-"));
    const confirm = vi.fn(async () => false);
    const registry = new ToolRegistry({
      cwd: tempDir,
      sessionId: "sess",
      agentId: "agent",
      capability: "FullAccess",
      confirm,
    });
    const { bashHandler, bashToolDefinition } = await import("./builtin/bash.js");
    registry.register(bashToolDefinition, bashHandler);

    const result = await registry.execute({
      id: "tu-bash-risky",
      name: "Bash",
      input: { command: "python add.py" },
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("denied");
  });

  it("still confirms Write outside trusted roots with WorkspaceWrite", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-scope-out-"));
    const confirm = vi.fn(async () => false);
    const registry = new ToolRegistry({
      cwd: tempDir,
      sessionId: "sess",
      agentId: "agent",
      capability: "WorkspaceWrite",
      confirm,
    });
    registry.register(writeToolDefinition, writeHandler);

    const outside = join(tmpdir(), `kako-outside-${Date.now()}.txt`);
    const result = await registry.execute({
      id: "tu-write-out",
      name: "Write",
      input: { file_path: outside, content: "nope" },
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("denied");
  });

  it("skips confirm for Write outside trusted roots with FullAccess", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-scope-out-full-"));
    const confirm = vi.fn(async () => false);
    const registry = new ToolRegistry({
      cwd: tempDir,
      sessionId: "sess",
      agentId: "agent",
      capability: "FullAccess",
      confirm,
    });
    registry.register(writeToolDefinition, writeHandler);

    const outside = join(tmpdir(), `kako-outside-full-${Date.now()}.txt`);
    const result = await registry.execute({
      id: "tu-write-out-full",
      name: "Write",
      input: { file_path: outside, content: "ok" },
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("skips confirm for Write under KAKO_HOME with FullAccess", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-scope-session-"));
    kakoHome = await mkdtemp(join(tmpdir(), "kako-home-"));
    process.env.KAKO_HOME = kakoHome;

    const skillDir = join(kakoHome, "skills", "demo");
    await mkdir(skillDir, { recursive: true });
    const target = join(skillDir, "note.md");

    const confirm = vi.fn(async () => false);
    const registry = new ToolRegistry({
      cwd: tempDir,
      sessionId: "sess",
      agentId: "agent",
      capability: "FullAccess",
      confirm,
    });
    registry.register(writeToolDefinition, writeHandler);

    const result = await registry.execute({
      id: "tu-kako",
      name: "Write",
      input: { file_path: target, content: "skill note" },
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("errors on Write with empty input without opening confirm", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-scope-write-empty-"));
    const confirm = vi.fn(async () => true);
    const registry = new ToolRegistry({
      cwd: tempDir,
      sessionId: "sess",
      agentId: "agent",
      confirm,
    });
    registry.register(writeToolDefinition, writeHandler);

    const result = await registry.execute({
      id: "tu-write-empty",
      name: "Write",
      input: {},
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.error).toContain("incomplete");
  });

  it("skips confirm for all writes in trusted workspace with FullAccess", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-scope-session-writes-"));
    const confirm = vi.fn(async () => ({ allowed: true, sessionAllow: "writes" as const }));
    const registry = new ToolRegistry({
      cwd: tempDir,
      sessionId: "sess",
      agentId: "agent",
      capability: "FullAccess",
      confirm,
    });
    registry.register(writeToolDefinition, writeHandler);

    const first = await registry.execute({
      id: "tu-write-1",
      name: "Write",
      input: { file_path: join(tempDir, "a.txt"), content: "one" },
    });
    const second = await registry.execute({
      id: "tu-write-2",
      name: "Write",
      input: { file_path: join(tempDir, "b.txt"), content: "two" },
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
  });

  it("skips confirm for identical bash after session allow", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-scope-session-bash-"));
    const confirm = vi.fn(async () => ({ allowed: true, sessionAllow: "bash-command" as const }));
    const registry = new ToolRegistry({
      cwd: tempDir,
      sessionId: "sess",
      agentId: "agent",
      confirm,
    });
    const { bashHandler, bashToolDefinition } = await import("./builtin/bash.js");
    registry.register(bashToolDefinition, bashHandler);

    const command = "python add.py";
    const first = await registry.execute({
      id: "tu-bash-1",
      name: "Bash",
      input: { command },
    });
    const second = await registry.execute({
      id: "tu-bash-2",
      name: "Bash",
      input: { command },
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
  });
});
