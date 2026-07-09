import { spawn } from "node:child_process";
import {
  defaultSettingsUrl,
  resolveKakoInstallRoot,
  resolveServerEntry,
  resolveWebDist,
  fetchWithTimeout,
} from "@kako/core";

type ServerHealth = { api: boolean; webUi: boolean };

async function fetchServerHealth(port: number): Promise<ServerHealth> {
  try {
    const res = await fetchWithTimeout(`http://localhost:${port}/api/health`, undefined, 1500);
    if (!res.ok) return { api: false, webUi: false };
    const body = (await res.json()) as { webUi?: boolean };
    return { api: true, webUi: body.webUi === true };
  } catch {
    return { api: false, webUi: false };
  }
}

function reportApiWithoutWebUi(port: number): void {
  console.error(`Port ${port} is in use by Kako API without the settings Web UI.`);
  console.error("Stop the other process first (e.g. pnpm dev:server), then run: kako web");
  console.error("Dev UI + API: pnpm dev:web  →  http://localhost:5173");
}

import { openSettingsWindow } from "../utils/open-settings-window.js";

export async function runWeb(): Promise<void> {
  const port = Number(process.env.KAKO_SERVER_PORT ?? 3721);
  const url = defaultSettingsUrl(port);
  const installRoot = resolveKakoInstallRoot();

  const existing = await fetchServerHealth(port);
  if (existing.api && existing.webUi) {
    console.log(`Kako settings already running at ${url}`);
    await openSettingsWindow(url);
    return;
  }
  if (existing.api && !existing.webUi) {
    reportApiWithoutWebUi(port);
    process.exit(1);
  }

  const webDist = await resolveWebDist(installRoot);
  const serverEntry = await resolveServerEntry(installRoot);
  if (!serverEntry) {
    console.error("Kako server not found. Reinstall Kako or run from the source repo.");
    console.error("From source: pnpm dev:web");
    process.exit(1);
  }
  if (!webDist) {
    console.error("Kako Web UI build not found.");
    console.error("From source: pnpm --filter @kako/web build && kako web");
    console.error("Or run: pnpm dev:web");
    process.exit(1);
  }

  console.log(`Starting Kako settings at ${url}`);
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      KAKO_WEB_DIST: webDist,
      KAKO_SERVER_PORT: String(port),
    },
    stdio: "inherit",
  });

  let ready: ServerHealth = { api: false, webUi: false };
  for (let i = 0; i < 30; i++) {
    ready = await fetchServerHealth(port);
    if (ready.api && ready.webUi) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (ready.api && ready.webUi) {
    await openSettingsWindow(url);
  } else if (ready.api && !ready.webUi) {
    console.error("Server started but Web UI is not available. Check KAKO_WEB_DIST.");
  } else {
    console.error("Server did not become ready in time.");
  }

  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      if (code && code !== 0) reject(new Error(`Server exited with code ${code}`));
      else resolve();
    });
  });
}
