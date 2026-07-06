import type { AskUserQuestionInput } from "@kako/shared";

/** Generic sample payload for AskUserQuestion integration tests. */
export const defaultChoiceQuestionInput: AskUserQuestionInput = {
  questions: [
    {
      question: "Which option should we use?",
      header: "Choice",
      multiSelect: false,
      options: [
        { label: "Option A", description: "First path" },
        { label: "Option B", description: "Second path" },
        { label: "Option C", description: "Third path" },
      ],
    },
  ],
};

/** @deprecated use defaultChoiceQuestionInput */
export const sampleDirectionQuestion = defaultChoiceQuestionInput;
