import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { UserAttachment, UserTurnInput } from "@kako/shared";
import { storeUserAttachment } from "./attachments.js";

const ATTACHMENT_PATTERN = /@(\/[^\s]+)/g;

export function stripAttachmentMarkers(text: string): string {
  return text.replace(ATTACHMENT_PATTERN, "").replace(/\s+/g, " ").trim();
}

export function extractAttachmentPaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(ATTACHMENT_PATTERN)) {
    const path = match[1]?.trim();
    if (path && isAbsolute(path)) {
      paths.push(path);
    }
  }
  return paths;
}

export async function resolveUserTurnInput(
  sessionId: string,
  text: string,
  pendingAttachments: UserAttachment[] = [],
): Promise<UserTurnInput> {
  const inlinePaths = extractAttachmentPaths(text);
  const stored: UserAttachment[] = [...pendingAttachments];

  for (const path of inlinePaths) {
    try {
      await access(path);
      stored.push(await storeUserAttachment(sessionId, path));
    } catch {
      throw new Error(`Attachment not found: ${path}`);
    }
  }

  const cleaned = stripAttachmentMarkers(text);
  return {
    text: cleaned,
    attachments: stored.length ? stored : undefined,
  };
}
