import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionMeta } from "@kako/shared";
import {
  agentsBucketEnteredAt,
  isAgentsSessionReadToday,
  loadAgentsReadSessionIds,
  loadAgentsSessionVisits,
  markAgentsSessionRead,
} from "./agents-session-reads.js";
import { isAgentsSessionUnreadInBucket } from "./agents-panel.js";

describe("agents-session-reads", () => {
  let home: string;
  const prevHome = process.env.KAKO_HOME;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-agents-reads-"));
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.KAKO_HOME;
    else process.env.KAKO_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  });

  it("marks a session visit with a timestamp", async () => {
    const now = new Date(2026, 6, 14, 12, 0, 0).getTime();
    expect(await loadAgentsSessionVisits(now)).toEqual(new Map());
    await markAgentsSessionRead("s1", now);
    const visits = await loadAgentsSessionVisits(now);
    expect(visits.get("s1")).toBe(now);
    expect(isAgentsSessionReadToday("s1", await loadAgentsReadSessionIds(now))).toBe(true);
    expect(isAgentsSessionReadToday("s2", await loadAgentsReadSessionIds(now))).toBe(false);
  });

  it("persists visits across reads (v2 format)", async () => {
    const now = new Date(2026, 6, 14, 12, 0, 0).getTime();
    await markAgentsSessionRead("s1", now);
    const raw = await readFile(join(home, "memory", "agents-session-reads.json"), "utf-8");
    expect(JSON.parse(raw)).toMatchObject({
      version: 2,
      visits: { s1: new Date(now).toISOString() },
    });
  });

  it("treats Needs input as unread until opened after agentState.since", () => {
    const entered = "2026-07-14T10:00:00.000Z";
    const meta = {
      id: "s1",
      updatedAt: entered,
      agentState: { state: "blocked", detail: "wait", tempo: "blocked", since: entered },
    } as SessionMeta;
    const visits = new Map<string, number>();
    expect(isAgentsSessionUnreadInBucket(meta, "needs_input", visits)).toBe(true);

    visits.set("s1", Date.parse("2026-07-14T09:00:00.000Z"));
    expect(isAgentsSessionUnreadInBucket(meta, "needs_input", visits)).toBe(true);

    visits.set("s1", Date.parse("2026-07-14T11:00:00.000Z"));
    expect(isAgentsSessionUnreadInBucket(meta, "needs_input", visits)).toBe(false);
  });

  it("re-marks unread when session re-enters Needs input after a prior visit", () => {
    const meta = {
      id: "s1",
      updatedAt: "2026-07-14T12:00:00.000Z",
      agentState: {
        state: "blocked",
        detail: "workflow finished",
        tempo: "blocked",
        since: "2026-07-14T12:00:00.000Z",
      },
    } as SessionMeta;
    const visits = new Map([["s1", Date.parse("2026-07-14T11:00:00.000Z")]]);
    expect(agentsBucketEnteredAt(meta)).toBe("2026-07-14T12:00:00.000Z");
    expect(isAgentsSessionUnreadInBucket(meta, "needs_input", visits)).toBe(true);
    expect(isAgentsSessionUnreadInBucket(meta, "working", visits)).toBe(false);
  });
});
