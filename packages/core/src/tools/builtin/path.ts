import { isAbsolute, resolve } from "node:path";

export function resolvePath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

export function lineCount(text: string): number {
  return text.split("\n").length;
}
