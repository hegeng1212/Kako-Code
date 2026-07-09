import { homedir } from "node:os";
import { join } from "node:path";

export function getDefaultKakoHome(): string {
  return join(homedir(), ".kako");
}

export function getKakoHome(): string {
  return process.env.KAKO_HOME ?? getDefaultKakoHome();
}

export function getConfigDir(): string {
  return join(getKakoHome(), "config");
}

export function getAgentsDir(): string {
  return join(getKakoHome(), "agents");
}

export function getSkillsDir(): string {
  return join(getKakoHome(), "skills");
}

export function getCheckpointsDir(): string {
  return join(getKakoHome(), "checkpoints");
}

export function getGlobalKakoMdPath(): string {
  return join(getKakoHome(), "KAKO.md");
}

export function getMemoryDir(): string {
  return join(getKakoHome(), "memory");
}

export function getLogsDir(): string {
  return join(getKakoHome(), "logs");
}

export function getPlansDir(): string {
  return join(getKakoHome(), "plans");
}

export function getSessionMemoryDir(sessionId: string): string {
  return join(getMemoryDir(), "sessions", sessionId);
}

export function getSessionWorkflowScriptPath(
  sessionId: string,
  name: string,
  runId: string,
): string {
  return join(getSessionMemoryDir(sessionId), "workflows", "scripts", `${name}-${runId}.js`);
}

/** Staging copy for workflow launch confirmation (editable before run). */
export function getWorkflowPreviewScriptPath(sessionId: string, name: string): string {
  return join(getSessionMemoryDir(sessionId), "workflows", "scripts", `.preview-${name}.js`);
}

export function getSessionWorkflowRunDir(sessionId: string, runId: string): string {
  return join(getSessionMemoryDir(sessionId), "subagents", "workflows", runId);
}

export function getSessionWorkflowJournalPath(sessionId: string, runId: string): string {
  return join(getSessionWorkflowRunDir(sessionId, runId), "journal.jsonl");
}

export function getSessionWorkflowRunsPath(sessionId: string): string {
  return join(getSessionMemoryDir(sessionId), "workflows", "runs.json");
}

export function getProjectsIndexPath(): string {
  return join(getIndexDir(), "projects.json");
}

export function getSessionReportsDir(sessionId: string): string {
  return join(getSessionMemoryDir(sessionId), "reports");
}

export function getWorkflowTemplatesDir(): string {
  return join(getKakoHome(), "workflows", "templates");
}

export function getSessionMetaPath(sessionId: string): string {
  return join(getSessionMemoryDir(sessionId), "meta.json");
}

export function getToolLogsDir(): string {
  return join(getLogsDir(), "tools");
}

export function getIndexDir(): string {
  return join(getKakoHome(), "index");
}

export function getObservabilityDbPath(): string {
  return join(getIndexDir(), "observability.db");
}

export function getScheduledTasksPath(): string {
  return join(getConfigDir(), "scheduled_tasks.json");
}

export function getInstalledSkillsManifestPath(): string {
  return join(getConfigDir(), "installed-skills.json");
}

/** Ephemeral runtime files. Production code must not use OS /tmp — use subdirs here instead. */
export function getRuntimeDir(): string {
  return join(getKakoHome(), "runtime");
}
