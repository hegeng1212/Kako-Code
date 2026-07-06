import { ansi } from "./ansi.js";

/** 4-step brightness cycle — same glyph width, no layout jitter. */
const PULSE_STEPS = [
  { bold: "", color: ansi.muted },
  { bold: "", color: ansi.text },
  { bold: ansi.bold, color: ansi.accent },
  { bold: "", color: ansi.text },
] as const;

/** Prefix icon with breathing brightness while content streams. */
export function renderPulsingIcon(glyph: string, frame: number, live: boolean): string {
  if (!live) {
    return `${ansi.muted}${glyph}${ansi.reset}`;
  }
  const step = PULSE_STEPS[frame % PULSE_STEPS.length]!;
  return `${step.bold}${step.color}${glyph}${ansi.reset}`;
}

export function renderPulsingPrefix(
  glyph: string,
  frame: number,
  live: boolean,
  trailingSpace = true,
): string {
  const space = trailingSpace ? " " : "";
  return `${renderPulsingIcon(glyph, frame, live)}${space}`;
}
