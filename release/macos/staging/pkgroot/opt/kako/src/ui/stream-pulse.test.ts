import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import { renderPulsingIcon, renderPulsingPrefix } from "./stream-pulse.js";

describe("stream-pulse", () => {
  it("cycles brightness when live", () => {
    const a = stripAnsi(renderPulsingIcon("●", 0, true));
    const b = stripAnsi(renderPulsingIcon("●", 2, true));
    expect(a).toBe("●");
    expect(b).toBe("●");
    expect(renderPulsingIcon("●", 0, true)).not.toBe(renderPulsingIcon("●", 2, true));
  });

  it("stays muted when not live", () => {
    expect(stripAnsi(renderPulsingPrefix("*", 2, false))).toBe("* ");
  });
});
