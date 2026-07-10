import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { addHostsToUserAllowlist, parseNetworkPolicy } from "./network-store.js";

describe("addHostsToUserAllowlist", () => {
  let tempHome = "";
  const prevKakoHome = process.env.KAKO_HOME;

  afterEach(async () => {
    process.env.KAKO_HOME = prevKakoHome;
    if (tempHome) await rm(tempHome, { recursive: true, force: true });
  });

  it("appends new hosts to userAllowlist and persists", async () => {
    tempHome = await mkdtemp(join(tmpdir(), "kako-net-store-"));
    process.env.KAKO_HOME = tempHome;
    await mkdir(join(tempHome, "config"), { recursive: true });

    const base = parseNetworkPolicy({
      version: 1,
      enabled: true,
      allowlist: [],
      blacklist: [],
      userAllowlist: [],
      mcpNetworkDenials: [],
    });

    const updated = await addHostsToUserAllowlist(["api.example.com"], base);
    expect(updated.userAllowlist).toEqual(["api.example.com"]);

    const text = await readFile(join(tempHome, "config", "network.json"), "utf8");
    const saved = parseNetworkPolicy(JSON.parse(text));
    expect(saved.userAllowlist).toEqual(["api.example.com"]);
  });

  it("skips hosts already covered by allowlist or userAllowlist", async () => {
    const base = parseNetworkPolicy({
      version: 1,
      enabled: true,
      allowlist: ["trusted.com"],
      blacklist: [],
      userAllowlist: ["saved.com"],
      mcpNetworkDenials: [],
    });

    const updated = await addHostsToUserAllowlist(
      ["trusted.com", "saved.com", "new.com"],
      base,
    );
    expect(updated.userAllowlist).toEqual(["saved.com", "new.com"]);
  });
});
