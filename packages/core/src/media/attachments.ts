import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LLMContentBlock, UserAttachment } from "@kako/shared";
import { getSessionMemoryDir } from "../config/paths.js";
import { attachmentKindForPath, mimeTypeForPath } from "./mime.js";
import { readDocumentText, readImageBlocks } from "./read-media.js";

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

export async function attachmentToContentBlocks(
  attachment: UserAttachment,
): Promise<LLMContentBlock[]> {
  if (attachment.kind === "image") {
    return readImageBlocks(attachment.path);
  }
  const text = await readDocumentText(attachment.path);
  return [
    {
      type: "text",
      text: `Attachment: ${attachment.name}\n\n${text}`,
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
  if (userText.trim()) {
    blocks.push({ type: "text", text: userText });
  }

  for (const attachment of attachments) {
    blocks.push(...(await attachmentToContentBlocks(attachment)));
  }

  return blocks.length ? blocks : userText;
}
