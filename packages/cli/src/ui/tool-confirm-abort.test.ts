import { describe, expect, it, vi } from "vitest";
import { raceToolConfirmWithTurnAbort } from "./tool-confirm-abort.js";

describe("raceToolConfirmWithTurnAbort", () => {
  it("returns confirm result when the turn is not aborted", async () => {
    const result = await raceToolConfirmWithTurnAbort(
      async () => ({ allowed: true }),
      () => false,
    );
    expect(result).toEqual({ allowed: true });
  });

  it("returns denied immediately when already aborted", async () => {
    const confirm = vi.fn(async () => ({ allowed: true }));
    const result = await raceToolConfirmWithTurnAbort(confirm, () => true);
    expect(result.allowed).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("unblocks a hung confirm when the turn aborts later", async () => {
    let aborted = false;
    const onAbort = vi.fn();
    const hung = raceToolConfirmWithTurnAbort(
      () => new Promise(() => {}),
      () => aborted,
      { pollMs: 20, onAbort },
    );

    await new Promise((r) => setTimeout(r, 30));
    aborted = true;

    const result = await hung;
    expect(result.allowed).toBe(false);
    expect(result.denialReason).toMatch(/interrupted/i);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});
