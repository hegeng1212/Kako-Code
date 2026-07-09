import { readFile } from "node:fs/promises";
import { loadWorkflowTemplate, parseMetaFromScriptSource, type WorkflowMeta } from "./registry.js";

export type WorkflowNameOrRef = string | { scriptPath: string };

export async function resolveNestedWorkflowScript(
  nameOrRef: WorkflowNameOrRef,
  cwd?: string,
): Promise<{ scriptPath: string; meta: WorkflowMeta }> {
  if (typeof nameOrRef === "string") {
    const name = nameOrRef.trim();
    if (!name) throw new Error("workflow() requires a non-empty name");
    const template = await loadWorkflowTemplate(name, cwd);
    return { scriptPath: template.templatePath, meta: template.meta };
  }

  const scriptPath = nameOrRef.scriptPath?.trim();
  if (!scriptPath) throw new Error("workflow({ scriptPath }) requires scriptPath");
  const source = await readFile(scriptPath, "utf-8");
  return { scriptPath, meta: parseMetaFromScriptSource(source) };
}
