import { ansi } from "./ansi.js";
import { FOOTER_HINT_INDENT } from "./input-footer.js";

export function formatInterruptedResumeHint(count: number): string {
  const label =
    count === 1
      ? "1 interrupted task"
      : `${Math.max(0, count)} interrupted tasks`;
  return `${FOOTER_HINT_INDENT}${ansi.planBorder}◉${ansi.reset} ${ansi.muted}${label} — enter to resume · esc to dismiss${ansi.reset}`;
}

export function interruptedResumeHintKey(key: string): "resume" | "dismiss" | "ignore" {
  if (key === "enter") return "resume";
  if (key === "escape") return "dismiss";
  return "ignore";
}
