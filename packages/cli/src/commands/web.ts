import { spawn } from "node:child_process";
import {
  defaultSettingsUrl,
  resolveKakoInstallRoot,
  resolveServerEntry,
  resolveWebDist,
} from "@kako/core";

async function isApiAvailable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function openBrowser(url: string): Promise<void> {
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

export async function runWeb(): Promise<void> {
  const port = Number(process.env.KAKO_SERVER_PORT ?? 3721);
  const url = defaultSettingsUrl(port);
  const installRoot = resolveKakoInstallRoot();

  if (await isApiAvailable(port)) {
    console.log(`Kako settings already running at ${url}`);
    await openBrowser(url);
    return;
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

  for (let i = 0; i < 30; i++) {
    if (await isApiAvailable(port)) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (await isApiAvailable(port)) {
    await openBrowser(url);
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
