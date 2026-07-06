import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

/** Open a file in Cursor or VS Code (`-g` goes to file). */
export async function openPlanInEditor(filePath: string): Promise<boolean> {
  for (const cmd of ["cursor", "code"]) {
    const opened = await new Promise<boolean>((resolve) => {
      const child = spawn(cmd, ["-g", filePath], {
        detached: true,
        stdio: "ignore",
      });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    });
    if (opened) return true;
  }
  return false;
}

export async function readPlanFileText(filePath: string): Promise<string> {
  try {
    return (await readFile(filePath, "utf-8")).trim();
  } catch {
    return "";
  }
}
