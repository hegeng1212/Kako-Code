import { describe, expect, it } from "vitest";
import { createExclusiveInteractiveQueue } from "./interactive-queue.js";

describe("createExclusiveInteractiveQueue", () => {
  it("runs callers one at a time and lets all settle", async () => {
    const queue = createExclusiveInteractiveQueue();
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];

    const task = (id: string) =>
      queue.runExclusiveInteractive(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(`start:${id}`);
        await new Promise((r) => setTimeout(r, 20));
        order.push(`end:${id}`);
        inFlight -= 1;
        return id;
      });

    const [a, b] = await Promise.all([task("a"), task("b")]);
    expect([a, b].sort()).toEqual(["a", "b"]);
    expect(maxInFlight).toBe(1);
    expect(order).toHaveLength(4);
    expect(order[0]).toMatch(/^start:/);
    expect(order[1]).toBe(order[0]!.replace("start:", "end:"));
    expect(order[2]).toMatch(/^start:/);
    expect(order[3]).toBe(order[2]!.replace("start:", "end:"));
  });

  it("continues the queue after a rejected interactive call", async () => {
    const queue = createExclusiveInteractiveQueue();
    await expect(
      queue.runExclusiveInteractive(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(queue.runExclusiveInteractive(async () => "ok")).resolves.toBe("ok");
  });

  it("serializes interleaved approval-style and workflow-confirm-style callers", async () => {
    const queue = createExclusiveInteractiveQueue();
    let active: string | null = null;
    const seen: string[] = [];

    const hold = (label: string) =>
      queue.runExclusiveInteractive(async () => {
        expect(active).toBeNull();
        active = label;
        seen.push(`enter:${label}`);
        await new Promise((r) => setTimeout(r, 15));
        seen.push(`leave:${label}`);
        active = null;
        return label;
      });

    const results = await Promise.all([hold("approval"), hold("workflowConfirm"), hold("approval")]);
    expect(results).toEqual(["approval", "workflowConfirm", "approval"]);
    expect(seen).toEqual([
      "enter:approval",
      "leave:approval",
      "enter:workflowConfirm",
      "leave:workflowConfirm",
      "enter:approval",
      "leave:approval",
    ]);
  });
});
