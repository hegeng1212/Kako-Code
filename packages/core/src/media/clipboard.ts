import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
