import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SkillBuildChatAttachment, UserAttachment } from "@kako/shared";
import { getRuntimeDir } from "../config/paths.js";
import { mimeTypeForPath, attachmentKindForPath } from "./mime.js";
import { mkdir } from "node:fs/promises";

export async function storeUploadedAttachment(
  sessionKey: string,
  upload: SkillBuildChatAttachment,
): Promise<UserAttachment> {
  const dir = join(getRuntimeDir(), "uploads", sessionKey);
  await mkdir(dir, { recursive: true });
  const safeName = upload.name.replace(/[^\w.-]+/g, "_") || "upload";
  const dest = join(dir, `${randomUUID().slice(0, 8)}-${safeName}`);
  await writeFile(dest, Buffer.from(upload.data, "base64"));
  return {
    name: upload.name,
    path: dest,
    mimeType: upload.mimeType || mimeTypeForPath(dest),
    kind: attachmentKindForPath(dest),
  };
}

export async function storeUploadedAttachments(
  sessionKey: string,
  uploads: SkillBuildChatAttachment[],
): Promise<UserAttachment[]> {
  const stored: UserAttachment[] = [];
  for (const upload of uploads) {
    stored.push(await storeUploadedAttachment(sessionKey, upload));
  }
  return stored;
}
