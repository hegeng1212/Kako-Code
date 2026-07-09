import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { aggregateWorkflowJournal, readJournalEntries } from "./journal.js";
import type { WorkflowRunRecord } from "./store.js";

function formatDurationMs(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${sec}s`;
}

function runElapsedMs(run: WorkflowRunRecord): number {
  const start = new Date(run.startedAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  return end - start;
}

function renderFindingsMarkdown(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  const lines: string[] = [];

  if (typeof record.summary === "string" && record.summary.trim()) {
    lines.push("## Summary", "", record.summary.trim(), "");
  }

  const findings = record.findings;
  if (Array.isArray(findings) && findings.length) {
    lines.push("## Findings", "");
    for (const item of findings) {
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      const claim = typeof f.claim === "string" ? f.claim : "Finding";
      const confidence = typeof f.confidence === "string" ? f.confidence : "unknown";
      lines.push(`### ${claim}`, "", `- Confidence: ${confidence}`);
      if (typeof f.evidence === "string" && f.evidence.trim()) {
        lines.push(`- Evidence: ${f.evidence.trim()}`);
      }
      if (Array.isArray(f.sources) && f.sources.length) {
        lines.push("- Sources:");
        for (const src of f.sources) {
          lines.push(`  - ${String(src)}`);
        }
      }
      lines.push("");
    }
  }

  if (typeof record.caveats === "string" && record.caveats.trim()) {
    lines.push("## Caveats", "", record.caveats.trim(), "");
  }

  const openQuestions = record.openQuestions;
  if (Array.isArray(openQuestions) && openQuestions.length) {
    lines.push("## Open questions", "");
    for (const q of openQuestions) {
      lines.push(`- ${String(q)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function saveWorkflowArtifact(
  sessionId: string,
  run: WorkflowRunRecord,
): Promise<{ markdownPath: string; jsonPath: string }> {
  await mkdir(run.transcriptDir, { recursive: true });
  const entries = await readJournalEntries(sessionId, run.runId);
  const phases = aggregateWorkflowJournal(entries);

  const jsonPath = join(run.transcriptDir, "saved-artifact.json");
  const markdownPath = join(run.transcriptDir, `${run.name}-${run.runId}.md`);

  const payload = {
    savedAt: new Date().toISOString(),
    run,
    phases,
    journalEntryCount: entries.length,
    result: run.result ?? null,
  };
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

  const phaseLines = phases.map(
    (p) => `- ${p.title}: ${p.done}/${Math.max(p.total, p.done)} agents${p.failed ? ` (${p.failed} failed)` : ""}`,
  );

  const markdown = [
    `# ${run.name} workflow save`,
    "",
    `- Run ID: ${run.runId}`,
    `- Task ID: ${run.taskId}`,
    `- Status: ${run.status}`,
    `- Elapsed: ${formatDurationMs(runElapsedMs(run))}`,
    `- Description: ${run.description}`,
    "",
    "## Phases",
    "",
    ...phaseLines,
    "",
    renderFindingsMarkdown(run.result),
    run.result ? "" : "_No final result yet — journal and metadata saved._",
    "",
    `Full JSON artifact: ${jsonPath}`,
    "",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");

  await writeFile(markdownPath, markdown, "utf-8");
  return { markdownPath, jsonPath };
}
