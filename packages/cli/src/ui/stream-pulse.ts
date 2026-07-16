import { ansi } from "./ansi.js";

/** 4-step brightness cycle — same glyph width, no layout jitter (generic UI). */
const PULSE_STEPS = [
  { bold: "", color: ansi.muted },
  { bold: "", color: ansi.text },
  { bold: ansi.bold, color: ansi.accent },
  { bold: "", color: ansi.text },
] as const;

/**
 * Soft program-red breath for live status verbs (* Refining…).
 * Frame advances every tick; step = floor(frame/3) → multi-second full cycle.
 */
const RED_BREATH_STEPS = [
  { bold: "", color: "\x1b[38;5;174m" }, // soft rose
  { bold: "", color: ansi.red },
  { bold: ansi.bold, color: ansi.red },
  { bold: "", color: ansi.accent }, // coral (same family)
  { bold: "", color: ansi.red },
  { bold: "", color: "\x1b[38;5;174m" },
] as const;

export const RED_BREATH_FRAME_DIVISOR = 3;

/**
 * Status * morph: point → cross → star → big star → shrink.
 * Width-1 glyphs only (avoid dingbat/emoji width-2 jitter). Dwell repeats for soft motion.
 */
export const LOADING_STAR_CYCLE = [
  ".",
  ".",
  "·",
  "·",
  "∙",
  "∙",
  "+",
  "+",
  "×",
  "×",
  "*",
  "*",
  "∗",
  "∗",
  "⋆",
  "⋆",
  "⋆", // peak
  "∗",
  "∗",
  "*",
  "*",
  "×",
  "×",
  "+",
  "+",
  "∙",
  "∙",
  "·",
  "·",
] as const;

/** Wrap modulus for turn.pulseFrame (glyph cycle length). */
export const PULSE_FRAME_MOD = LOADING_STAR_CYCLE.length;

/** Glyph at pulse frame — grow then shrink through the loading star cycle. */
export function loadingStarGlyph(frame: number): string {
  const i = ((frame % PULSE_FRAME_MOD) + PULSE_FRAME_MOD) % PULSE_FRAME_MOD;
  return LOADING_STAR_CYCLE[i]!;
}

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

/** Slow soft program-red breath for status glyph + verb (not metadata). */
export function renderBreathingRedText(text: string, frame: number, live: boolean): string {
  if (!live) {
    return `${ansi.muted}${text}${ansi.reset}`;
  }
  const step =
    RED_BREATH_STEPS[Math.floor(frame / RED_BREATH_FRAME_DIVISOR) % RED_BREATH_STEPS.length]!;
  return `${step.bold}${step.color}${text}${ansi.reset}`;
}

/**
 * Live status prefix: morphing star glyph + red breath.
 * When `glyph` is `*` (Musing / Working line), run the loading star cycle.
 */
export function renderBreathingRedPrefix(
  glyph: string,
  frame: number,
  live: boolean,
  trailingSpace = true,
): string {
  const space = trailingSpace ? " " : "";
  const shown = live && glyph === "*" ? loadingStarGlyph(frame) : glyph;
  return `${renderBreathingRedText(shown, frame, live)}${space}`;
}
