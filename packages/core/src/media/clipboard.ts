import { execFile, spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function spawnWithStdin(command: string, args: readonly string[], input: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.stdin.write(input);
    child.stdin.end();
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

const MAC_CLIPBOARD_SCRIPT = `
try
  set imageData to the clipboard as «class PNGf»
  set filePath to POSIX path of (path to temporary items folder) & "kako-clipboard.png"
  set fileRef to open for access filePath with write permission
  write imageData to fileRef
  close access fileRef
  return filePath
on error
  try
    set imageData to the clipboard as «class TIFF»
    set filePath to POSIX path of (path to temporary items folder) & "kako-clipboard.tiff"
    set fileRef to open for access filePath with write permission
    write imageData to fileRef
    close access fileRef
    return filePath
  on error
    return ""
  end try
end try
`;

/** Read plain text from the system clipboard. Returns null when unavailable. */
export async function readClipboardText(): Promise<string | null> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("pbpaste", [], {
        timeout: 3000,
        maxBuffer: 1024 * 1024,
      });
      const text = stdout.trim();
      return text.length ? text : null;
    } catch {
      return null;
    }
  }
  if (process.platform === "linux") {
    try {
      const { stdout } = await execFileAsync(
        "xclip",
        ["-selection", "clipboard", "-o"],
        { timeout: 3000, maxBuffer: 1024 * 1024 },
      );
      const text = String(stdout).trim();
      return text.length ? text : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Write plain text to the system clipboard. */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false;
  if (process.platform === "darwin") {
    try {
      return await spawnWithStdin("pbcopy", [], text);
    } catch {
      return false;
    }
  }
  if (process.platform === "linux") {
    try {
      return await spawnWithStdin("xclip", ["-selection", "clipboard"], text);
    } catch {
      return false;
    }
  }
  return false;
}

/** Read an image from the system clipboard. Returns null when unavailable. */
export async function readClipboardImage(): Promise<{
  buffer: Buffer;
  mimeType: string;
} | null> {
  if (process.platform === "darwin") {
    return readMacClipboardImage();
  }
  if (process.platform === "linux") {
    return readLinuxClipboardImage();
  }
  return null;
}

async function readMacClipboardImage(): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", MAC_CLIPBOARD_SCRIPT], {
      timeout: 5000,
    });
    const path = stdout.trim();
    if (!path) return tryPngpaste();
    const buffer = await readFile(path);
    await unlink(path).catch(() => {});
    const mimeType = path.endsWith(".tiff") ? "image/tiff" : "image/png";
    return { buffer, mimeType };
  } catch {
    return tryPngpaste();
  }
}

async function tryPngpaste(): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const tmpPath = join(tmpdir(), `kako-clipboard-${randomUUID()}.png`);
  try {
    await execFileAsync("pngpaste", [tmpPath], { timeout: 3000 });
    const buffer = await readFile(tmpPath);
    await unlink(tmpPath).catch(() => {});
    return { buffer, mimeType: "image/png" };
  } catch {
    await unlink(tmpPath).catch(() => {});
    return null;
  }
}

async function readLinuxClipboardImage(): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const { stdout } = await execFileAsync(
      "xclip",
      ["-selection", "clipboard", "-t", "image/png", "-o"],
      { timeout: 3000, maxBuffer: 20 * 1024 * 1024, encoding: "buffer" },
    );
    const buffer = stdout as Buffer;
    if (!buffer?.length) return null;
    return { buffer, mimeType: "image/png" };
  } catch {
    return null;
  }
}
