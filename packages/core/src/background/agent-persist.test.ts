import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listActiveAgentPayloads,
  removeActiveAgentPayload,
  upsertActiveAgentPayload,
} from "./agent-persist.js";

describe("agent-persist", () => {
  afterEach(() => {
    delete process.env.KAKO_HOME;
  });

  it("upserts active agent payload and removes it", async () => {
    process.env.KAKO_HOME = await mkdtemp(join(tmpdir(), "kako-ag-persist-"));
    await upsertActiveAgentPayload("sess-a", {
      taskId: "a1",
      description: "Explore Option A",
      prompt: "Look at Option A",
      subagentName: "explore",
      startedAt: new Date().toISOString(),
    });
    expect(await listActiveAgentPayloads("sess-a")).toHaveLength(1);
    await removeActiveAgentPayload("sess-a", "a1");
    expect(await listActiveAgentPayloads("sess-a")).toHaveLength(0);
  });
});
