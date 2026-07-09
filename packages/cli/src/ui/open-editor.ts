import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

/** Open a file in Cursor, VS Code, or $EDITOR. Blocks until the editor exits when using $EDITOR. */
export async function openFileInEditor(filePath: string): Promise<boolean> {
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

  const editor = process.env.EDITOR?.trim() || process.env.VISUAL?.trim();
  if (!editor) return false;

  const result = spawnSync(editor, [filePath], { stdio: "inherit" });
  return result.status === 0 || result.status === null;
}

/** @deprecated Use openFileInEditor */
export const openPlanInEditor = openFileInEditor;

export async function readEditorFileText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/** @deprecated Use readEditorFileText */
export async function readPlanFileText(filePath: string): Promise<string> {
  try {
    return (await readFile(filePath, "utf-8")).trim();
  } catch {
    return "";
  }
}
