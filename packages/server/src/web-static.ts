import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export function resolveWebDistDir(): string | undefined {
  const dir = process.env.KAKO_WEB_DIST?.trim();
  return dir || undefined;
}

function safePath(root: string, urlPath: string): string | null {
  const rel = urlPath.split("?")[0]?.split("#")[0] ?? "/";
  const decoded = decodeURIComponent(rel);
  const filePath = normalize(join(root, decoded === "/" ? "index.html" : decoded));
  if (!filePath.startsWith(normalize(root))) return null;
  return filePath;
}

async function resolveFile(webRoot: string, url: string): Promise<string> {
  const initial = safePath(webRoot, url);
  if (!initial) throw new Error("forbidden");

  try {
    const info = await stat(initial);
    if (info.isDirectory()) {
      return join(initial, "index.html");
    }
    return initial;
  } catch {
    return join(webRoot, "index.html");
  }
}

/** Serve Vite build output; returns true when the request was handled. */
export async function tryServeWebStatic(
  req: IncomingMessage,
  res: ServerResponse,
  webRoot: string,
): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = req.url ?? "/";
  if (url.startsWith("/api")) return false;

  let filePath: string;
  try {
    filePath = await resolveFile(webRoot, url);
    await stat(filePath);
  } catch {
    res.statusCode = url.includes(".") ? 404 : 200;
    filePath = join(webRoot, "index.html");
    try {
      await stat(filePath);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
      return true;
    }
  }

  const ext = extname(filePath);
  res.setHeader("content-type", MIME[ext] ?? "application/octet-stream");
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(filePath).pipe(res);
  return true;
}
