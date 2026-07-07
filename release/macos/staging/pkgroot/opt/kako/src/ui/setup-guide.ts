import type { ProviderReadiness } from "@kako/shared";
import { ansi, pink, pinkBold, stripAnsi } from "./ansi.js";
import {
  computeClaudeBoxLayout,
  renderClaudeBottomBorder,
  renderClaudeFooter,
  renderClaudeRow,
  renderClaudeTopBorder,
} from "./box.js";
import { KAKO_DINO } from "./mascot.js";

const DEFAULT_WEB_URL = "http://localhost:5173";
const DEFAULT_API_URL = "http://localhost:3721";

export interface SetupGuideOptions {
  readiness: ProviderReadiness;
  webUrl?: string;
  apiUrl?: string;
  serverRunning: boolean;
}

async function isApiAvailable(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function tryOpenBrowser(url: string): Promise<void> {
  if (process.env.KAKO_NO_OPEN_BROWSER === "1") return;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    await exec(cmd, args);
  } catch {
    // ignore
  }
}

export function renderSetupGuide(options: SetupGuideOptions): string {
  const webUrl = options.webUrl ?? DEFAULT_WEB_URL;
  const layout = computeClaudeBoxLayout();
  const title = "Kako — Setup required";

  const leftLines = [
    "",
    pinkBold("Welcome!"),
    "",
    ...KAKO_DINO.map((row) => pink(row)),
    "",
    `${ansi.muted}Model not configured${ansi.reset}`,
    "",
  ];

  const rightLines: string[] = [
    pinkBold("Tips for getting started"),
    ...options.readiness.issues.map(
      (issue) => `${ansi.text}${issue}${ansi.reset}`,
    ),
    `${ansi.accent}${"─".repeat(Math.min(layout.rightContentWidth, 40))}${ansi.reset}`,
    pinkBold("Next steps"),
  ];

  if (options.serverRunning) {
    rightLines.push(
      `${ansi.text}Open ${webUrl} to add a provider.${ansi.reset}`,
      `${ansi.text}Set API Key, choose a model, then enable.${ansi.reset}`,
      `${ansi.text}Run kako again when done.${ansi.reset}`,
    );
  } else {
    rightLines.push(
      `${ansi.text}Run pnpm dev:web in the kako repo.${ansi.reset}`,
      `${ansi.text}Open ${webUrl} to configure providers.${ansi.reset}`,
      `${ansi.text}Run kako again when done.${ansi.reset}`,
    );
  }

  rightLines.push(`${ansi.muted}${ansi.italic}${webUrl}${ansi.reset}`, "");

  const rows = Math.max(leftLines.length, rightLines.length);
  const out: string[] = ["", renderClaudeTopBorder(title, layout.inner)];

  for (let i = 0; i < rows; i++) {
    out.push(
      renderClaudeRow(leftLines[i] ?? "", rightLines[i] ?? "", layout, "center"),
    );
  }

  out.push(renderClaudeBottomBorder(layout.inner));
  out.push(
    renderClaudeFooter({
      placeholder: 'Configure model in Web UI first',
      shortcuts: "? for shortcuts · /help for commands",
    }),
  );

  return out.join("\n");
}

export async function guideProviderSetup(readiness: ProviderReadiness): Promise<never> {
  const webUrl = process.env.KAKO_WEB_UI_URL ?? DEFAULT_WEB_URL;
  const apiUrl = process.env.KAKO_API_URL ?? DEFAULT_API_URL;
  const serverRunning = await isApiAvailable(apiUrl);

  console.log(renderSetupGuide({ readiness, webUrl, apiUrl, serverRunning }));

  if (serverRunning) {
    console.log(`${ansi.muted}Opening browser…${ansi.reset}`);
    await tryOpenBrowser(webUrl);
  }

  process.exit(1);
}

export { stripAnsi };
