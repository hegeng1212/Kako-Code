/** A file attached to a user turn (image or office document). */
export interface UserAttachment {
  name: string;
  /** Absolute path where the attachment is stored for this session. */
  path: string;
  /** Original path on disk when copied from a user file reference. */
  sourcePath?: string;
  mimeType: string;
  kind: "image" | "document";
}

/** User input for one agent turn (CLI / Web composer). */
export interface UserTurnInput {
  /** Shown in UI / stored as transcript content. */
  text: string;
  /** When set, sent to the LLM instead of `text` (slash skill harness injection). */
  llmText?: string;
  /** When set, sent to the LLM as separate user content blocks (after harness context reminder). */
  llmBlocks?: import("./llm.js").LLMContentBlock[];
  attachments?: UserAttachment[];
  /** True when the user typed this prompt in the CLI chat box (↑/↓ history). */
  cliInput?: boolean;
}

export function isUserTurnInput(value: string | UserTurnInput): value is UserTurnInput {
  return typeof value === "object" && value !== null && "text" in value;
}

export function normalizeUserTurnInput(value: string | UserTurnInput): UserTurnInput {
  if (isUserTurnInput(value)) {
    return {
      text: value.text ?? "",
      llmText: value.llmText?.trim() || undefined,
      llmBlocks: value.llmBlocks?.length ? value.llmBlocks : undefined,
      attachments: value.attachments?.length ? value.attachments : undefined,
      cliInput: value.cliInput === true ? true : undefined,
    };
  }
  return { text: value };
}
