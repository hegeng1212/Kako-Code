import type { UserAttachment } from "@kako/shared";
import { formatPeekPresentationBashCommand } from "./peek-presentation.js";
import { formatPeekSpreadsheetBashCommand } from "./peek-spreadsheet.js";
import { isPresentationPath, isProseDocumentPath, isSpreadsheetPath } from "./mime.js";

export function attachmentIncludesPresentation(attachments?: UserAttachment[]): boolean {
  return (
    attachments?.some((a) => a.kind === "document" && isPresentationPath(a.path)) ?? false
  );
}

export function attachmentIncludesSpreadsheet(attachments?: UserAttachment[]): boolean {
  return (
    attachments?.some((a) => a.kind === "document" && isSpreadsheetPath(a.path)) ?? false
  );
}

export function attachmentIncludesProseDocument(attachments?: UserAttachment[]): boolean {
  return (
    attachments?.some((a) => a.kind === "document" && isProseDocumentPath(a.path)) ?? false
  );
}

export function attachmentIncludesDocument(attachments?: UserAttachment[]): boolean {
  return attachments?.some((a) => a.kind === "document") ?? false;
}

function formatAttachedFileList(attachments: UserAttachment[]): string {
  return attachments
    .filter((a) => a.kind === "document")
    .map((doc) => {
      const source = doc.sourcePath ? ` (source: ${doc.sourcePath})` : "";
      return `- ${doc.name}: session path \`${doc.path}\`${source}`;
    })
    .join("\n");
}

/** Mandatory harness contract — separate from optional workspace system-reminder. */
export function formatFileAttachmentContract(attachments?: UserAttachment[]): string {
  if (!attachmentIncludesDocument(attachments)) return "";

  const docs = attachments!.filter((a) => a.kind === "document");
  const hasSpreadsheet = attachmentIncludesSpreadsheet(attachments);
  const hasPresentation = attachmentIncludesPresentation(attachments);
  const hasProse = attachmentIncludesProseDocument(attachments);

  const lines: string[] = [
    "<file-attachment-contract>",
    "REQUIRED: The user attached file(s). This contract overrides default “open Read and dump the file” behavior.",
    "",
    "Attached files:",
    formatAttachedFileList(docs),
    "",
    "Use **Session path** from <file-reference> blocks and this list. Your **first tool call** for this turn MUST be **Bash** (not Read) — inspect size, list sheets/pages, sample first rows. Do not invent values.",
    "",
    "## Step 0 — Bash first (required)",
    "The first tool you invoke for attached files must be **Bash**: `stat`, then the harness **`kako peek-*`** command for the file type (see below). Only use Read later for embedded images or small targeted slices.",
    "- Do **not** run `pip install`, `npm install`, `python -c` with pptx/pandas/xlsx, or `node -e` unless the user explicitly asks.",
    "- **Small files** may use Read after Bash confirms size; **large** spreadsheets and long documents stay on Bash (+ Agent chunk summaries for prose).",
    "",
    "## Embedded images",
    "If Bash inspection or extraction reveals images inside the file (PDF pages, Word/PowerPoint slides, sheet charts, archive members), **extract each image** (Bash) and analyze it **separately** with Read (multimodal). Merge image findings into the final answer.",
  ];

  if (hasSpreadsheet) {
    const samplePath = docs.find((d) => isSpreadsheetPath(d.path))?.path ?? docs[0]!.path;
    const peekCmd = formatPeekSpreadsheetBashCommand(samplePath, 5);
    lines.push(
      "",
      "## Spreadsheets (.xlsx, .xls, .csv, .tsv)",
      "1. Use the structure preview in <file-reference> and the question in <user-query>.",
      "2. **First tool = Bash** — run **exactly** this harness command (Session path):",
      `   \`${peekCmd}\``,
      "3. Do **not** substitute `node -e`, python/pandas, or pip install — `kako peek-spreadsheet` bundles xlsx.",
      "4. For csv/tsv only, `head -n 5` on Session path is OK after `stat`.",
      "5. Answer with further Bash filtering on the Session path — not Read dumps.",
      "6. If data is still too large, process overlapping row windows, summarize each window, then synthesize once.",
    );
  }

  if (hasPresentation) {
    const samplePath =
      docs.find((d) => isPresentationPath(d.path))?.path ?? docs[0]!.path;
    const peekCmd = formatPeekPresentationBashCommand(samplePath, 5);
    lines.push(
      "",
      "## PowerPoint (.pptx, .ppt)",
      "1. After `stat`, run **exactly** this harness command (Session path):",
      `   \`${peekCmd}\``,
      "2. Do **not** use python-pptx, pip install, or ad-hoc Python — `kako peek-presentation` bundles extraction.",
      "3. For long decks, increase slide count in steps or use Agent chunk summarization on extracted text.",
    );
  }

  if (hasProse) {
    lines.push(
      "",
      "## Long-form documents (PDF, Word, PowerPoint, .txt, .md, …)",
      "1. **Bash extract** full text (or page/slide-bounded text) to temp files or stdout — do not paste the entire extraction into chat at once.",
      "2. **Split** the extracted text into overlapping chunks (each chunk shares a trailing/leading overlap with the next so context is preserved).",
      "3. **Sub-agent summarization** — dispatch one **Agent** sub-task per chunk (or parallel batches) to produce concise summaries. Collect all chunk summaries.",
      "4. **Final answer** — synthesize once from the combined summaries (and any embedded-image Read results), aligned with <user-query>.",
      "5. For PDFs, prefer Bash page-range extraction before whole-file Read. Use Read `pages` only for small, targeted slices.",
    );
  }

  lines.push(
    "",
    "## Evidence",
    "Respond only from tool output (Bash, Agent chunk summaries, targeted Read, image Read). If the question is unclear, ask — do not guess file contents.",
    "</file-attachment-contract>",
  );

  return lines.join("\n");
}

/** Wrap the user's question when document attachments are present. */
export function wrapUserTextWithAttachmentContract(
  userText: string,
  attachments?: UserAttachment[],
): string {
  const trimmed = userText.trim();
  if (!trimmed || !attachmentIncludesDocument(attachments)) {
    return userText;
  }
  const contract = formatFileAttachmentContract(attachments);
  return `<user-query>\n${trimmed}\n</user-query>\n\n${contract}`;
}

export function formatAttachmentSystemPromptAddendum(): string {
  return `\n\n## File attachments (mandatory)
The user's latest message includes attached files. Follow \`<file-attachment-contract>\` in that user message.
- Your **first tool call** must be **Bash**: **kako peek-spreadsheet** or **kako peek-presentation** on Session path (not python-pptx/pandas, not node -e, not pip).
- Do not pip/npm install packages unless the user explicitly asks.
- Use Agent sub-tasks for chunked summarization of long extracted text.`;
}
