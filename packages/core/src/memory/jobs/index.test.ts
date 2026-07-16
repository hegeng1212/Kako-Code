import { describe, expect, it } from "vitest";
import { parseMemorySettings } from "../../config/memory-store.js";
import { runMemoryJob } from "./index.js";

describe("memory jobs stubs", () => {
  it("returns disabled for consolidate/curator/dreaming by default", async () => {
    const settings = parseMemorySettings({});
    for (const name of ["consolidate", "curator", "dreaming"] as const) {
      expect(await runMemoryJob(name, settings)).toEqual({
        skipped: true,
        reason: "disabled",
      });
    }
  });
});
