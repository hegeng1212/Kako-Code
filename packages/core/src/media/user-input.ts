import type { UserAttachment, UserTurnInput } from "@kako/shared";
import { storeUserAttachment } from "./attachments.js";
import { parsePathReferences } from "./path-ref.js";

export async function resolveUserTurnInput(
  sessionId: string,
  text: string,
  pendingAttachments: UserAttachment[] = [],
): Promise<UserTurnInput> {
  const { paths, text: questionText } = await parsePathReferences(text);
  const stored: UserAttachment[] = [...pendingAttachments];

  for (const path of paths) {
    stored.push(await storeUserAttachment(sessionId, path));
  }

  return {
    text: questionText,
    attachments: stored.length ? stored : undefined,
  };
}
