/** A file attached to a user turn (image or office document). */
export interface UserAttachment {
  name: string;
  /** Absolute path where the attachment is stored for this session. */
  path: string;
  mimeType: string;
  kind: "image" | "document";
}

/** User input for one agent turn (CLI / Web composer). */
export interface UserTurnInput {
  text: string;
  attachments?: UserAttachment[];
}

export function isUserTurnInput(value: string | UserTurnInput): value is UserTurnInput {
  return typeof value === "object" && value !== null && "text" in value;
}

export function normalizeUserTurnInput(value: string | UserTurnInput): UserTurnInput {
  if (isUserTurnInput(value)) {
    return {
      text: value.text ?? "",
      attachments: value.attachments?.length ? value.attachments : undefined,
    };
  }
  return { text: value };
}
