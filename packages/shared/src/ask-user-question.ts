/** One selectable option in an AskUserQuestion prompt. */
export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

/** A single question presented to the user. */
export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

/** Model → harness input for AskUserQuestion. */
export interface AskUserQuestionInput {
  questions: AskUserQuestionItem[];
  metadata?: { source?: string };
}

/** User → model output returned as tool result. */
export interface AskUserQuestionResult {
  answers: Record<string, string>;
  annotations?: Record<string, { notes?: string; preview?: string }>;
  /** True when the user dismissed the choice UI (e.g. Esc). */
  declined?: boolean;
}

export type AskUserQuestionPrompt = (
  input: AskUserQuestionInput,
) => Promise<AskUserQuestionResult>;
