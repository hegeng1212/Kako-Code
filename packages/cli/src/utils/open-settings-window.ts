import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Open settings UI in a minimal app window (no browser tabs/bookmarks). */
export async function openSettingsWindow(url: string): Promise<void> {
  if (process.env.KAKO_NO_OPEN_BROWSER === "1") return;

  if (process.env.KAKO_WEB_BROWSER_MODE === "tab") {
    await openDefaultBrowser(url);
    return;
  }

  const opened = await tryOpenAppWindow(url);
  if (!opened) await openDefaultBrowser(url);
}

async function openDefaultBrowser(url: string): Promise<void> {
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

async function tryOpenAppWindow(url: string): Promise<boolean> {
  if (process.platform === "darwin") {
    for (const app of ["Google Chrome", "Microsoft Edge", "Chromium"]) {
      try {
        await exec("open", ["-na", app, "--args", `--app=${url}`]);
        return true;
      } catch {
        // try next browser
      }
    }
    return false;
  }

  if (process.platform === "win32") {
    for (const browser of ["chrome", "msedge"]) {
      try {
        await exec("cmd", ["/c", "start", "", browser, `--app=${url}`]);
        return true;
      } catch {
        // try next browser
      }
    }
    return false;
  }

  for (const browser of ["google-chrome", "chromium-browser", "chromium", "microsoft-edge"]) {
    try {
      await exec(browser, [`--app=${url}`]);
      return true;
    } catch {
      // try next browser
    }
  }
  return false;
}
