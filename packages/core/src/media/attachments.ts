import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LLMContentBlock, UserAttachment } from "@kako/shared";
import { getSessionMemoryDir } from "../config/paths.js";
import { attachmentKindForPath, mimeTypeForPath, isPresentationPath, isSpreadsheetPath } from "./mime.js";
import { wrapUserTextWithAttachmentContract } from "./attachment-reminders.js";
import { formatPeekPresentationBashCommand } from "./peek-presentation.js";
import { formatPeekSpreadsheetBashCommand } from "./peek-spreadsheet.js";
import { previewDocumentText, readImageBlocks } from "./read-media.js";

function formatAttachmentHarnessNote(attachment: UserAttachment): string {
  const path = attachment.path;
  if (isSpreadsheetPath(path)) {
    return `Harness note: first Bash → \`${formatPeekSpreadsheetBashCommand(path, 5)}\``;
  }
  if (isPresentationPath(path)) {
    return `Harness note: first Bash → \`${formatPeekPresentationBashCommand(path, 5)}\``;
  }
  return "Harness note: follow <file-attachment-contract> — Bash first (stat), then type-specific kako peek-* or extraction.";
}

export function getSessionAttachmentsDir(sessionId: string): string {
  return join(getSessionMemoryDir(sessionId), "attachments");
}

export async function storeUserAttachment(
  sessionId: string,
  sourcePath: string,
  name?: string,
): Promise<UserAttachment> {
  const dir = getSessionAttachmentsDir(sessionId);
  await mkdir(dir, { recursive: true });
  const fileName = `${randomUUID().slice(0, 8)}-${basename(name ?? sourcePath)}`;
  const dest = join(dir, fileName);
  await copyFile(sourcePath, dest);
  return {
    name: name ?? basename(sourcePath),
    path: dest,
    sourcePath,
    mimeType: mimeTypeForPath(dest),
    kind: attachmentKindForPath(dest),
  };
}

export async function storeClipboardImage(
  sessionId: string,
  imageBuffer: Buffer,
  mimeType = "image/png",
): Promise<UserAttachment> {
  const dir = getSessionAttachmentsDir(sessionId);
  await mkdir(dir, { recursive: true });
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const dest = join(dir, `paste-${randomUUID().slice(0, 8)}.${ext}`);
  await writeFile(dest, imageBuffer);
  return {
    name: `pasted-image.${ext}`,
    path: dest,
    mimeType,
    kind: "image",
  };
}

/** Persist tab-separated clipboard grid as a session attachment. */
export async function storePastedTable(
  sessionId: string,
  tsvText: string,
): Promise<UserAttachment> {
  const dir = getSessionAttachmentsDir(sessionId);
  await mkdir(dir, { recursive: true });
  const normalized = tsvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  const lines = normalized.split("\n").filter((line) => line.length > 0);
  const colCount = Math.max(
    0,
    ...lines.filter((line) => line.includes("\t")).map((line) => line.split("\t").length),
  );
  const dest = join(dir, `paste-${randomUUID().slice(0, 8)}.tsv`);
  await writeFile(dest, normalized.endsWith("\n") ? normalized : `${normalized}\n`, "utf-8");
  return {
    name: `pasted-table-${lines.length}x${colCount}.tsv`,
    path: dest,
    mimeType: mimeTypeForPath(dest),
    kind: "document",
  };
}

export async function attachmentToContentBlocks(
  attachment: UserAttachment,
): Promise<LLMContentBlock[]> {
  if (attachment.kind === "image") {
    return readImageBlocks(attachment.path);
  }
  const preview = await previewDocumentText(attachment.path);
  const sourceLine = attachment.sourcePath
    ? `Source path: ${attachment.sourcePath}\n`
    : "";
  return [
    {
      type: "text",
      text: `<file-reference>
Name: ${attachment.name}
Session path: ${attachment.path}
${sourceLine}Structure preview (full content is not loaded):

${preview}

${formatAttachmentHarnessNote(attachment)}
</file-reference>`,
    },
  ];
}

export async function buildUserContentBlocks(
  userText: string,
  attachments?: UserAttachment[],
): Promise<string | LLMContentBlock[]> {
  if (!attachments?.length) {
    return userText;
  }

  const blocks: LLMContentBlock[] = [];
  const displayText = wrapUserTextWithAttachmentContract(userText, attachments);
  if (displayText.trim()) {
    blocks.push({ type: "text", text: displayText });
  }

  for (const attachment of attachments) {
    blocks.push(...(await attachmentToContentBlocks(attachment)));
  }

  return blocks.length ? blocks : userText;
}
