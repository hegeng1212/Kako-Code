import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getWorkflowPreviewScriptPath } from "../config/paths.js";
import {
  loadWorkflowTemplateSource,
  parseMetaFromScriptSource,
  type WorkflowMeta,
} from "./registry.js";

export interface WorkflowConfirmPreview {
  meta: WorkflowMeta;
  source: string;
  previewScriptPath: string;
}

export async function prepareWorkflowConfirm(input: {
  sessionId: string;
  cwd: string;
  name?: string;
  script?: string;
  scriptPath?: string;
}): Promise<WorkflowConfirmPreview> {
  let source: string;
  let meta: WorkflowMeta;

  if (typeof input.script === "string" && input.script.trim()) {
    source = input.script;
    meta = parseMetaFromScriptSource(source);
  } else if (input.scriptPath) {
    source = await readFile(input.scriptPath, "utf-8");
    meta = parseMetaFromScriptSource(source);
  } else if (input.name) {
    const template = await loadWorkflowTemplateSource(input.name, input.cwd);
    source = template.source;
    meta = template.meta;
  } else {
    throw new Error("Workflow requires name, scriptPath, or script");
  }

  const previewScriptPath = getWorkflowPreviewScriptPath(input.sessionId, meta.name);
  await mkdir(dirname(previewScriptPath), { recursive: true });
  await writeFile(previewScriptPath, source, "utf-8");

  return { meta, source, previewScriptPath };
}
