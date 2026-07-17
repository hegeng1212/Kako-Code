import { describe, expect, it } from "vitest";
import { ansi, displayWidth, stripAnsi } from "./ansi.js";
import {
  ANSWER_PULSE_FRAME_DIVISOR,
  LOADING_STAR_CYCLE,
  loadingStarGlyph,
  PULSE_FRAME_MOD,
  renderAnswerPulsingPrefix,
  renderBreathingRedPrefix,
  renderBreathingRedText,
  renderMutedPulsingIcon,
  renderPulsingIcon,
  renderPulsingPrefix,
} from "./stream-pulse.js";

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

  it("breathes red slowly across frames", () => {
    const a = renderBreathingRedText("Refining…", 0, true);
    const b = renderBreathingRedText("Refining…", 3, true);
    expect(stripAnsi(a)).toBe("Refining…");
    expect(a).not.toBe(b);
    expect(renderBreathingRedText("Refining…", 0, true)).toBe(
      renderBreathingRedText("Refining…", 2, true),
    );
  });

  it("morphs the status * through point → orb → star → peak → shrink", () => {
    expect(LOADING_STAR_CYCLE[0]).toBe(".");
    expect(LOADING_STAR_CYCLE).toContain("o");
    expect(LOADING_STAR_CYCLE).toContain("O");
    expect(LOADING_STAR_CYCLE).toContain("*");
    expect(PULSE_FRAME_MOD).toBe(LOADING_STAR_CYCLE.length);

    const glyphs = LOADING_STAR_CYCLE.map((_, i) => loadingStarGlyph(i));
    expect(new Set(glyphs).size).toBeGreaterThanOrEqual(4);
    // Peak should appear near the middle of the cycle.
    const peakAt = glyphs.indexOf("*");
    expect(peakAt).toBeGreaterThan(glyphs.length / 4);
    expect(peakAt).toBeLessThan((glyphs.length * 3) / 4);

    // Grow then shrink: early frames are "smaller" than mid, then return toward ".".
    expect(glyphs[0]).toBe(".");
    expect(glyphs[glyphs.length - 1]).toBe(".");
  });

  it("keeps loading-star glyphs single-column ASCII for baseline alignment", () => {
    for (const g of LOADING_STAR_CYCLE) {
      expect(displayWidth(g)).toBe(1);
      expect(/^[.oO*]$/.test(g)).toBe(true);
    }
  });

  it("uses morphing glyphs when live status prefix is *", () => {
    const a = stripAnsi(renderBreathingRedPrefix("*", 0, true));
    const b = stripAnsi(renderBreathingRedPrefix("*", 6, true));
    expect(a.trim()).toBe(loadingStarGlyph(0));
    expect(b.trim()).toBe(loadingStarGlyph(6));
    expect(a.trim()).not.toBe(b.trim());
  });

  it("keeps thinking pulse glyphs in muted gray while live", () => {
    for (let f = 0; f < 8; f++) {
      const painted = renderMutedPulsingIcon("◐", f, true);
      expect(painted).toContain(ansi.muted);
      expect(painted).not.toContain(ansi.text);
      expect(painted).not.toContain(ansi.accent);
    }
  });

  it("slows the answer ● brightness cycle vs raw pulse frames", () => {
    expect(ANSWER_PULSE_FRAME_DIVISOR).toBeGreaterThanOrEqual(4);
    const early = renderAnswerPulsingPrefix("●", 0, true);
    const midDivisor = renderAnswerPulsingPrefix("●", ANSWER_PULSE_FRAME_DIVISOR - 1, true);
    const nextStep = renderAnswerPulsingPrefix("●", ANSWER_PULSE_FRAME_DIVISOR, true);
    expect(early).toBe(midDivisor);
    expect(nextStep).not.toBe(early);
  });

  it("keeps answer ● brightness in muted gray only (no accent/bold bleed)", () => {
    for (let f = 0; f < 24; f++) {
      const painted = renderAnswerPulsingPrefix("●", f, true);
      expect(painted).not.toContain(ansi.accent);
      expect(painted).not.toContain(ansi.bold);
      expect(painted).not.toContain(ansi.text);
    }
  });
});
