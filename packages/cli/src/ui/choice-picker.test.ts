import { describe, expect, it } from "vitest";
import {
  buildChoiceRows,
  buildMultiChoiceRows,
  buildWizardReviewRows,
  parseChoiceInputActions,
  renderChoicePanelLines,
  renderQuestionWizardPanelLines,
  renderWizardReviewSummary,
} from "./choice-picker.js";

describe("choice-picker", () => {
  it("builds rows with Type something and Chat about this", () => {
    const rows = buildChoiceRows(
      [
        { label: "A", description: "first" },
        { label: "B", description: "second" },
      ],
      true,
    );
    expect(rows).toHaveLength(4);
    expect(rows[2]!.kind).toBe("custom");
    expect(rows[2]!.label).toBe("Type something.");
    expect(rows[3]!.kind).toBe("chat");
    expect(rows[3]!.label).toBe("Chat about this");
  });

  it("builds multi-select rows with Submit before Chat", () => {
    const rows = buildMultiChoiceRows([
      { label: "A", description: "first" },
      { label: "B", description: "second" },
    ]);
    expect(rows).toHaveLength(5);
    expect(rows[2]!.kind).toBe("custom");
    expect(rows[3]!.kind).toBe("submit");
    expect(rows[4]!.kind).toBe("chat");
  });

  it("renders multi-select checkboxes for options", () => {
    const rows = buildMultiChoiceRows([
      { label: "A", description: "alpha" },
      { label: "B", description: "beta" },
    ]);
    const checked = new Set([0]);
    const lines = renderChoicePanelLines({
      header: "Features",
      question: "Which features?",
      rows,
      selectedIndex: 1,
      cols: 100,
      multiSelect: true,
      checkedOptionIndexes: checked,
      showHeader: true,
    });
    const plain = lines.join("\n");
    expect(plain).toContain("[✔]");
    expect(plain).toContain("[ ]");
    expect(plain).toContain("(multi-select)");
    expect(plain).toContain("Submit");
  });

  it("renders selected row with > marker", () => {
    const lines = renderChoicePanelLines({
      header: "Library",
      question: "Which one?",
      rows: buildChoiceRows([{ label: "A", description: "alpha" }]),
      selectedIndex: 0,
      cols: 80,
    });
    expect(lines.some((l) => l.includes(">"))).toBe(true);
    expect(lines.some((l) => l.includes("Library"))).toBe(true);
    expect(lines.some((l) => l.includes("Which one?"))).toBe(true);
  });

  it("omits header chip when showHeader is false", () => {
    const lines = renderChoicePanelLines({
      header: "Library",
      question: "Which one?",
      rows: buildChoiceRows([{ label: "A", description: "alpha" }]),
      selectedIndex: 0,
      cols: 80,
      showHeader: false,
    });
    expect(lines.some((l) => l.includes("Library"))).toBe(false);
    expect(lines.some((l) => l.includes("Which one?"))).toBe(true);
  });

  it("parses arrow keys for navigation", () => {
    expect(parseChoiceInputActions("\x1b[A").actions).toEqual([{ type: "up" }]);
    expect(parseChoiceInputActions("\x1b[B").actions).toEqual([{ type: "down" }]);
    expect(parseChoiceInputActions("\x1b[C").actions).toEqual([{ type: "right" }]);
    expect(parseChoiceInputActions("\x1b[D").actions).toEqual([{ type: "left" }]);
    expect(parseChoiceInputActions("\r").actions).toEqual([{ type: "enter" }]);
  });

  it("renders wizard review summary with submit actions", () => {
    const questions = [
      {
        question: "Which stack?",
        header: "Stack",
        multiSelect: false,
        options: [
          { label: "Python", description: "py" },
          { label: "Node", description: "js" },
        ],
      },
      {
        question: "Which features?",
        header: "Features",
        multiSelect: true,
        options: [
          { label: "Memory", description: "ctx" },
          { label: "Search", description: "web" },
        ],
      },
    ];
    const answers = {
      "Which stack?": "Python",
      "Which features?": "Memory, Search",
    };
    const summary = renderWizardReviewSummary(questions, answers, 100).join("\n");
    expect(summary).toContain("Review your answers");
    expect(summary).toContain("→ Python");
    expect(summary).toContain("→ Memory, Search");
    expect(summary).toContain("Ready to submit your answers?");

    const rows = buildWizardReviewRows();
    const panel = renderQuestionWizardPanelLines({
      questions,
      answers,
      focusIndex: questions.length,
      rows,
      selectedIndex: 0,
      cols: 100,
    }).join("\n");
    expect(panel).toContain("Submit answers");
    expect(panel).toContain("Cancel");
  });
});
