import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detailPreviewFromL1,
  feedClassifierMilestoneToL1,
  resolveAgentsDetailPreview,
} from "./detail-bridge.js";
import { consolidateToL1 } from "./compact.js";
import { createMessage } from "./store.js";
import { closeMemoryFtsDb } from "./index-fts.js";
import { appendMemoryBootstrapSections, buildMessages } from "../agent/context.js";

describe("agents detail ↔ L1 bridge", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-detail-"));
    prevHome = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prevHome;
    closeMemoryFtsDb();
    await rm(home, { recursive: true, force: true });
  });

  it("feeds classifier milestone into L1 Next without putting detail into RAG assembly", async () => {
    const sessionId = "sess-detail";
    await consolidateToL1({
      sessionId,
      transcript: [
        createMessage("user", "Work on Option A"),
        createMessage("assistant", "Starting Option A"),
      ],
    });

    const updated = await feedClassifierMilestoneToL1(sessionId, {
      state: "working",
      detail: "writing tests",
    });
    expect(updated?.sections.Next).toContain("writing tests");
    expect(detailPreviewFromL1(updated)?.toLowerCase()).toContain("writing");

    const system = appendMemoryBootstrapSections("You are Kako.", {
      sessionSummary: "L1 summary body",
      retrievedContext: "1. [L1] /x\nsnippet",
    });
    expect(system).toContain("Previous Session Summary");
    expect(system).toContain("untrusted");
    expect(system).not.toContain("writing tests");

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
      sessionSummary: "summary only",
      // Intentionally omit any agentState.detail — contract under test.
    });
    const sys = String(messages[0]?.content ?? "");
    expect(sys).toContain("summary only");
    expect(sys).not.toContain("agentState");
  });

  it("resolves UI preview from classifier detail first", () => {
    expect(
      resolveAgentsDetailPreview(
        {
          state: "working",
          detail: "running tools",
          tempo: "active",
          since: new Date().toISOString(),
        },
        null,
      ),
    ).toBe("running tools");
  });
});
