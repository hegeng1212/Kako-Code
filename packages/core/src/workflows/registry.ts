import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  findBundledWorkflowsDir,
  findCorePackageWorkflowsDir,
} from "../config/bundled-assets.js";
import { resolveKakoInstallRoot } from "../config/install-paths.js";
import { getSessionWorkflowScriptPath, getWorkflowTemplatesDir } from "../config/paths.js";

export interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: Array<{ title: string; detail?: string; agents?: number }>;
}

export interface WorkflowTemplate {
  name: string;
  templatePath: string;
  meta: WorkflowMeta;
}

export interface WorkflowTemplateSource {
  name: string;
  templatePath: string;
  meta: WorkflowMeta;
  source: string;
}

function parseMetaFromScript(source: string): WorkflowMeta {
  return parseMetaFromScriptSource(source);
}

export function findWorkflowMetaBlockRange(
  source: string,
): { start: number; end: number } | undefined {
  const startMatch = source.match(/export const meta\s*=\s*\{/);
  if (!startMatch || startMatch.index === undefined) {
    return undefined;
  }
  const openBrace = startMatch.index + startMatch[0].length - 1;
  let depth = 0;
  let closeBrace = -1;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        closeBrace = i;
        break;
      }
    }
  }
  if (closeBrace === -1) {
    return undefined;
  }
  let end = closeBrace + 1;
  while (end < source.length && /[\s;]/.test(source[end]!)) {
    end++;
  }
  return { start: startMatch.index, end };
}

export function stripWorkflowMetaBlock(source: string): string {
  const range = findWorkflowMetaBlockRange(source);
  if (!range) return source;
  return `${source.slice(0, range.start)}${source.slice(range.end)}`.replace(/^\s+/, "");
}

export async function loadWorkflowMetaFromScriptPath(
  scriptPath: string,
): Promise<WorkflowMeta | null> {
  try {
    const source = await readFile(scriptPath, "utf-8");
    return parseMetaFromScriptSource(source);
  } catch {
    return null;
  }
}

export function parseMetaFromScriptSource(source: string): WorkflowMeta {
  const range = findWorkflowMetaBlockRange(source);
  if (!range) {
    throw new Error("Workflow script missing export const meta");
  }
  const startMatch = source.slice(0, range.end).match(/export const meta\s*=\s*\{/);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error("Workflow script missing export const meta");
  }
  const openBrace = startMatch.index + startMatch[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = openBrace; i < range.end; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) {
    throw new Error("Workflow script meta block is unclosed");
  }
  const metaLiteral = source.slice(openBrace, close + 1);
  // eslint-disable-next-line no-new-func
  const meta = new Function(`return (${metaLiteral})`)() as WorkflowMeta;
  if (!meta.name || !meta.description) {
    throw new Error("Workflow meta requires name and description");
  }
  return meta;
}

async function tryReadWorkflowTemplateFile(
  templatePath: string,
  name: string,
): Promise<WorkflowTemplateSource | undefined> {
  try {
    const source = await readFile(templatePath, "utf-8");
    return { name, templatePath, meta: parseMetaFromScript(source), source };
  } catch {
    return undefined;
  }
}

/** Candidate template paths in priority order — each must exist on disk. */
export async function listWorkflowTemplateCandidatePaths(
  name: string,
  cwd?: string,
): Promise<string[]> {
  const paths: string[] = [];
  const seen = new Set<string>();

  const push = (path: string) => {
    if (!seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  };

  if (cwd) {
    push(join(cwd, ".kako", "workflows", `${name}.js`));
  }

  push(join(getWorkflowTemplatesDir(), `${name}.js`));

  const coreBundled = await findCorePackageWorkflowsDir();
  if (coreBundled) {
    push(join(coreBundled, `${name}.js`));
  }

  const installRoot = resolveKakoInstallRoot();
  if (installRoot) {
    push(join(installRoot, "workflows", "templates", `${name}.js`));
  }

  const kakoHome = process.env.KAKO_HOME?.trim() || join(homedir(), ".kako");
  push(join(kakoHome, "app", "workflows", "templates", `${name}.js`));

  const kakoSrc = process.env.KAKO_SRC?.trim();
  if (kakoSrc) {
    push(join(kakoSrc, "workflows", "templates", `${name}.js`));
  }

  push(join(kakoHome, "src", "Kako-Code", "workflows", "templates", `${name}.js`));

  const bundledDir = await findBundledWorkflowsDir();
  if (bundledDir) {
    push(join(bundledDir, `${name}.js`));
  }

  return paths;
}

export async function loadWorkflowTemplateSource(
  name: string,
  cwd?: string,
): Promise<WorkflowTemplateSource> {
  for (const templatePath of await listWorkflowTemplateCandidatePaths(name, cwd)) {
    const loaded = await tryReadWorkflowTemplateFile(templatePath, name);
    if (loaded) return loaded;
  }

  throw new Error(
    `Workflow template not found: ${name}. Run \`kako\` once to seed ~/.kako/workflows/templates, or reinstall with the install script.`,
  );
}

export async function loadWorkflowTemplate(name: string, cwd?: string): Promise<WorkflowTemplate> {
  const { name: n, templatePath, meta } = await loadWorkflowTemplateSource(name, cwd);
  return { name: n, templatePath, meta };
}

export async function copyWorkflowTemplateToSession(input: {
  sessionId: string;
  name: string;
  runId: string;
  cwd?: string;
}): Promise<{ scriptPath: string; meta: WorkflowMeta }> {
  const template = await loadWorkflowTemplateSource(input.name, input.cwd);
  const scriptPath = getSessionWorkflowScriptPath(input.sessionId, input.name, input.runId);
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, template.source, "utf-8");
  return { scriptPath, meta: template.meta };
}
