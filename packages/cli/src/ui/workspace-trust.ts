import { ansi, pinkBold } from "./ansi.js";
import { wrapContentLines } from "./text-wrap.js";

export type WorkspaceTrustDecision = "trust" | "exit";

const OPTIONS = ["Yes, I trust this folder", "No, exit"] as const;

const SAFETY_COPY =
  "Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first.";

const CAPABILITY_COPY = "Kako will be able to read, edit, and execute files here.";

const FOOTER = "Enter to confirm · Esc to cancel";

/** Content rows only — trailing newline after the block is not counted. */
export function trustPromptContentLineCount(text: string): number {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!body) return 0;
  return body.split("\n").length;
}

export function renderWorkspaceTrustPrompt(cwd: string, selectedIndex = 0): string {
  const cols = Math.max(40, process.stdout.columns ?? 80);
  const wrapWidth = Math.max(32, cols - 4);
  const selected = Math.max(0, Math.min(OPTIONS.length - 1, selectedIndex));
  const rule = `${ansi.yellow}${"─".repeat(Math.min(cols, 72))}${ansi.reset}`;

  const lines: string[] = [
    rule,
    pinkBold("Accessing workspace:"),
    `${ansi.blue}${ansi.bold}${cwd}${ansi.reset}`,
    "",
    ...wrapContentLines(SAFETY_COPY, wrapWidth).map(
      (line) => `${ansi.text}${line}${ansi.reset}`,
    ),
    "",
    `${ansi.text}${CAPABILITY_COPY}${ansi.reset}`,
    "",
  ];

  for (let i = 0; i < OPTIONS.length; i++) {
    const isSelected = i === selected;
    const cursor = isSelected ? `${ansi.accent}>${ansi.reset}` : " ";
    const labelColor = isSelected ? ansi.accent : ansi.muted;
    lines.push(
      `${ansi.reset}${cursor} ${labelColor}${i + 1}. ${OPTIONS[i]}${ansi.reset}`,
    );
  }

  lines.push("");
  lines.push(`${ansi.muted}${FOOTER}${ansi.reset}`);
  // Always end with a trailing newline so the cursor sits on the blank line below.
  return `${lines.join("\n")}\n`;
}

/**
 * Redraw the trust panel in place.
 * Assumes the cursor is on the line immediately below the previous panel.
 */
export function rewriteTrustPromptInPlace(prevContentLines: number, next: string): number {
  const body = next.endsWith("\n") ? next.slice(0, -1) : next;
  const rows = body.length > 0 ? body.split("\n") : [""];
  const nextCount = rows.length;

  if (prevContentLines > 0) {
    process.stdout.write(`\x1b[${prevContentLines}A\r`);
  } else {
    process.stdout.write("\r");
  }

  const max = Math.max(prevContentLines, nextCount);
  for (let i = 0; i < max; i++) {
    process.stdout.write("\x1b[2K");
    if (i < nextCount) {
      process.stdout.write(rows[i]!);
    }
    if (i < max - 1) {
      process.stdout.write("\n");
    }
  }
  process.stdout.write("\n");
  return nextCount;
}

export async function promptWorkspaceTrust(cwd: string): Promise<WorkspaceTrustDecision> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "exit";
  }

  let selected = 0;
  let rendered = renderWorkspaceTrustPrompt(cwd, selected);
  let lineCount = trustPromptContentLineCount(rendered);
  process.stdout.write(rendered);

  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  try {
    return await new Promise<WorkspaceTrustDecision>((resolve) => {
      const onData = (chunk: string): void => {
        if (chunk === "\u0003") {
          cleanup();
          resolve("exit");
          return;
        }
        if (chunk === "\u001b[A" || chunk === "k") {
          selected = Math.max(0, selected - 1);
          lineCount = rewriteTrustPromptInPlace(
            lineCount,
            renderWorkspaceTrustPrompt(cwd, selected),
          );
          return;
        }
        if (chunk === "\u001b[B" || chunk === "j") {
          selected = Math.min(OPTIONS.length - 1, selected + 1);
          lineCount = rewriteTrustPromptInPlace(
            lineCount,
            renderWorkspaceTrustPrompt(cwd, selected),
          );
          return;
        }
        if (chunk === "\u001b") {
          cleanup();
          resolve("exit");
          return;
        }
        if (chunk === "\r" || chunk === "\n") {
          cleanup();
          resolve(selected === 0 ? "trust" : "exit");
          return;
        }
        if (chunk === "1") {
          selected = 0;
          lineCount = rewriteTrustPromptInPlace(
            lineCount,
            renderWorkspaceTrustPrompt(cwd, selected),
          );
          return;
        }
        if (chunk === "2") {
          selected = 1;
          lineCount = rewriteTrustPromptInPlace(
            lineCount,
            renderWorkspaceTrustPrompt(cwd, selected),
          );
        }
      };

      const cleanup = (): void => {
        process.stdin.off("data", onData);
      };

      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(wasRaw ?? false);
    process.stdin.pause();
  }
}
