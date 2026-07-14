import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";
import { memoryPinHandler, memoryPinToolDefinition } from "./memory-pin.js";
import { toolContext } from "./test-helpers.js";
import { savePins } from "../../memory/pins.js";
import { createPin } from "../../memory/pins.js";

describe("MemoryPin tool definition", () => {
  it("requires action", () => {
    expect(memoryPinToolDefinition.inputSchema.required).toEqual(["action"]);
    expect(memoryPinToolDefinition.name).toBe("MemoryPin");
  });
});

describe("MemoryPin handler", () => {
  let home: string;
  let prev: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-pin-"));
    prev = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    process.env.KAKO_HOME = prev;
    await rm(home, { recursive: true, force: true });
  });

  it("adds lists and removes pins", async () => {
    const ctx = toolContext("/tmp", { sessionId: "sess-pin" as never });
    const added = JSON.parse(String(await memoryPinHandler({ action: "add", content: "Option A path" }, ctx)));
    expect(added.ok).toBe(true);
    expect(added.pins.length).toBe(1);

    const listed = JSON.parse(String(await memoryPinHandler({ action: "list" }, ctx)));
    expect(listed.pins.length).toBe(1);

    const id = listed.pins[0].id as string;
    const removed = JSON.parse(String(await memoryPinHandler({ action: "remove", id }, ctx)));
    expect(removed.pins.length).toBe(0);
  });

  it("rejects add when over cap", async () => {
    const ctx = toolContext("/tmp", { sessionId: "sess-cap" as never });
    const many = Array.from({ length: DEFAULT_MEMORY_INJECT_CAPS.pinsMaxCount }, (_, i) =>
      createPin(`pin-${i}`),
    );
    await savePins("sess-cap" as never, many);
    const out = JSON.parse(
      String(await memoryPinHandler({ action: "add", content: "overflow" }, ctx)),
    );
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/cap/i);
  });
});
