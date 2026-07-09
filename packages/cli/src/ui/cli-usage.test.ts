import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  getCliUsagePath,
  loadCliUsage,
  recordCliLaunch,
  resolveChatHeaderMode,
  STANDARD_HEADER_AFTER_IDLE_MS,
} from "./cli-usage.js";

const priorHome = process.env.KAKO_HOME;

afterEach(async () => {
  if (priorHome === undefined) delete process.env.KAKO_HOME;
  else process.env.KAKO_HOME = priorHome;
});

describe("resolveChatHeaderMode", () => {
  it("uses standard header on first launch", () => {
    expect(resolveChatHeaderMode({})).toBe("standard");
  });

  it("uses mini header when last launch was recent", () => {
    const now = new Date("2026-07-09T12:00:00Z");
    const last = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(resolveChatHeaderMode({ lastLaunchAt: last }, now)).toBe("mini");
  });

  it("uses standard header after three days idle", () => {
    const now = new Date("2026-07-09T12:00:00Z");
    const last = new Date(now.getTime() - STANDARD_HEADER_AFTER_IDLE_MS).toISOString();
    expect(resolveChatHeaderMode({ lastLaunchAt: last }, now)).toBe("standard");
  });
});

describe("cli usage persistence", () => {
  it("records and loads last launch timestamp", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-cli-usage-"));
    process.env.KAKO_HOME = home;
    const when = new Date("2026-07-08T08:00:00Z");
    await recordCliLaunch(when);
    expect(await loadCliUsage()).toEqual({ lastLaunchAt: when.toISOString() });
    const text = await readFile(getCliUsagePath(), "utf-8");
    expect(text).toContain('"lastLaunchAt"');
    await rm(home, { recursive: true, force: true });
  });
});
