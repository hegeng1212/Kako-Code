import { describe, expect, it } from "vitest";
import {
  aggregateWorkflowJournal,
  readJournalEntries,
  resolveCurrentPhaseFromJournal,
  summarizeAgentOutput,
} from "./journal.js";

const META_PHASES = [
  { title: "Scope", detail: "Decompose question" },
  { title: "Search", detail: "Parallel web search" },
  { title: "Fetch", detail: "Fetch sources" },
  { title: "Verify", detail: "Adversarial verify" },
  { title: "Synthesize", detail: "Write report" },
];

describe("aggregateWorkflowJournal", () => {
  it("seeds phases from workflow meta before any journal entries", () => {
    const phases = aggregateWorkflowJournal([], META_PHASES);
    expect(phases.map((p) => p.title)).toEqual([
      "Scope",
      "Search",
      "Fetch",
      "Verify",
      "Synthesize",
    ]);
    expect(phases.every((p) => !p.entered && p.agents.length === 0)).toBe(true);
    expect(phases[0]?.detail).toBe("Decompose question");
    expect(phases[0]?.logs).toEqual([]);
  });

  it("marks phase entered on phase() journal events and aggregates agents", () => {
    const phases = aggregateWorkflowJournal(
      [
        { type: "phase", title: "Scope", at: "t0" },
        { type: "agent_start", label: "scope", phase: "Scope", at: "t1" },
        {
          type: "result",
          label: "scope",
          phase: "Scope",
          status: "success",
          tokens: 100,
          durationMs: 1200,
          output: { summary: "Decomposed into 5 angles", angles: [{}, {}, {}, {}, {}] },
          at: "t2",
        },
      ],
      META_PHASES,
    );
    expect(phases[0]?.entered).toBe(true);
    expect(phases[0]?.done).toBe(1);
    expect(phases[0]?.agents[0]?.label).toBe("scope");
    expect(phases[0]?.agents[0]?.outputSummary).toBe("Decomposed into 5 angles");
    expect(phases[1]?.entered).toBe(false);
  });

  it("associates log entries with the active phase", () => {
    const phases = aggregateWorkflowJournal(
      [
        { type: "phase", title: "Scope", at: "t0" },
        { type: "log", message: "Q: test question", at: "t1" },
        { type: "phase", title: "Search", at: "t2" },
        { type: "log", message: "Search: 5 angles", at: "t3" },
      ],
      META_PHASES,
    );
    expect(phases[0]?.logs).toEqual(["Q: test question"]);
    expect(phases[1]?.logs).toEqual(["Search: 5 angles"]);
  });

  it("uses current phase when agent_start omits phase", () => {
    const phases = aggregateWorkflowJournal(
      [
        { type: "phase", title: "Scope", at: "t0" },
        { type: "agent_start", label: "scope", at: "t1" },
        { type: "result", label: "scope", status: "success", output: { summary: "ok" }, at: "t2" },
      ],
      META_PHASES,
    );
    expect(phases[0]?.title).toBe("Scope");
    expect(phases[0]?.agents[0]?.status).toBe("success");
    expect(phases.find((p) => p.title === "Unknown")).toBeUndefined();
  });

  it("routes phaseless agents to first meta phase when no phase event yet", () => {
    const phases = aggregateWorkflowJournal(
      [
        { type: "agent_start", label: "scope", at: "t1" },
        {
          type: "result",
          label: "scope",
          status: "success",
          output: { summary: "Decomposed", angles: [{}, {}, {}, {}, {}] },
          at: "t2",
        },
      ],
      META_PHASES,
    );
    expect(phases[0]?.title).toBe("Scope");
    expect(phases[0]?.agents[0]?.label).toBe("scope");
    expect(phases.find((p) => p.title === "Unknown")).toBeUndefined();
  });

  it("updates the same agent row when result follows start", () => {
    const phases = aggregateWorkflowJournal(
      [
        { type: "phase", title: "Search", at: "t0" },
        {
          type: "agent_start",
          label: "search:Broad/primary",
          phase: "Search",
          agentId: "a1",
          at: "t1",
        },
        {
          type: "result",
          label: "search:Broad/primary",
          phase: "Search",
          agentId: "a1",
          status: "success",
          tokens: 20,
          output: { results: [{}, {}, {}, {}, {}, {}] },
          at: "t2",
        },
      ],
      META_PHASES,
    );
    const search = phases.find((p) => p.title === "Search");
    expect(search?.agents).toHaveLength(1);
    expect(search?.agents[0]?.status).toBe("success");
    expect(search?.agents[0]?.tokens).toBe(20);
    expect(search?.agents[0]?.outputSummary).toBe("6 search results");
  });

  it("merges out-of-order result before agent_start into one row", () => {
    const phases = aggregateWorkflowJournal(
      [
        { type: "phase", title: "Search", at: "t0" },
        {
          type: "result",
          label: "search:Policy environment",
          phase: "Search",
          agentId: "a2",
          status: "success",
          output: { results: [{}, {}] },
          at: "t1",
        },
        {
          type: "agent_start",
          label: "search:Policy environment",
          phase: "Search",
          agentId: "a2",
          at: "t2",
        },
      ],
      META_PHASES,
    );
    const search = phases.find((p) => p.title === "Search");
    expect(search?.agents).toHaveLength(1);
    expect(search?.agents[0]?.status).toBe("success");
    expect(search?.done).toBe(1);
  });

  it("matches duplicate labels via agentId", () => {
    const phases = aggregateWorkflowJournal(
      [
        { type: "phase", title: "Fetch", at: "t0" },
        { type: "agent_start", label: "fetch:example.com", phase: "Fetch", agentId: "a1", at: "t1" },
        { type: "agent_start", label: "fetch:example.com", phase: "Fetch", agentId: "a2", at: "t2" },
        { type: "result", label: "fetch:example.com", phase: "Fetch", agentId: "a2", status: "success", output: { claims: [1, 2] }, at: "t3" },
        { type: "result", label: "fetch:example.com", phase: "Fetch", agentId: "a1", status: "success", output: { claims: [3] }, at: "t4" },
      ],
      META_PHASES,
    );
    const fetch = phases.find((p) => p.title === "Fetch");
    expect(fetch?.agents).toHaveLength(2);
    expect(fetch?.agents.every((a) => a.status === "success")).toBe(true);
    expect(fetch?.done).toBe(2);
  });
});

describe("summarizeAgentOutput", () => {
  it("prefers error and summary fields", () => {
    expect(summarizeAgentOutput({ error: "No question" })).toBe("No question");
    expect(summarizeAgentOutput({ summary: "Done" })).toBe("Done");
  });
});

describe("resolveCurrentPhaseFromJournal", () => {
  it("returns the last phase title", () => {
    expect(
      resolveCurrentPhaseFromJournal([
        { type: "phase", title: "Scope", at: "t0" },
        { type: "phase", title: "Verify", at: "t1" },
      ]),
    ).toBe("Verify");
  });
});

describe("readJournalEntries", () => {
  it("skips corrupt lines and keeps valid entries", async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const home = await mkdtemp(join(tmpdir(), "kako-journal-"));
    const sessionId = "sess-journal";
    const runId = "wf_test";
    process.env.KAKO_HOME = home;
    const dir = join(home, "memory/sessions", sessionId, "subagents/workflows", runId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "journal.jsonl"),
      [
        JSON.stringify({ type: "phase", title: "Scope", at: "t0" }),
        "not valid json",
        JSON.stringify({ type: "log", message: "hello", at: "t1" }),
      ].join("\n") + "\n",
      "utf-8",
    );
    const entries = await readJournalEntries(sessionId, runId);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.type).toBe("phase");
    expect(entries[1]?.type).toBe("log");
    delete process.env.KAKO_HOME;
  });
});
