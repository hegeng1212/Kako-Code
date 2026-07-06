import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolExecutionContext } from "@kako/shared";

/** Run a test callback in an isolated temp directory (always cleaned up). */
export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kako-tool-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function toolContext(
  cwd: string,
  overrides?: Partial<ToolExecutionContext>,
): ToolExecutionContext {
  return {
    agentId: "agent-test",
    sessionId: "sess-test",
    toolUseId: "tu-test",
    cwd,
    ...overrides,
  };
}
