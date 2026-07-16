import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import {
  buildChoiceRows,
  buildMultiChoiceRows,
  buildWizardReviewRows,
  checkedIndexesFromAnswer,
  composeMultiSelectAnswer,
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
    expect(plain).toContain("[✓]");
    expect(plain).toContain("[ ]");
    expect(plain).toContain("可多选");
    expect(plain).toContain("Submit");
    expect(plain).toContain("alpha");
    expect(plain.indexOf("A")).toBeLessThan(plain.indexOf("alpha"));
  });

  it("hides Type something placeholder when custom row is checked", () => {
    const rows = buildMultiChoiceRows([
      { label: "A", description: "alpha" },
      { label: "B", description: "beta" },
    ]);
    const customIdx = rows.findIndex((r) => r.kind === "custom");
    const armed = renderChoicePanelLines({
      header: "Focus",
      question: "Which aspects?",
      rows,
      selectedIndex: customIdx,
      cols: 100,
      multiSelect: true,
      checkedOptionIndexes: new Set(),
      customText: "",
      customChecked: true,
      showHeader: true,
    });
    const armedPlain = stripAnsi(armed.join("\n"));
    expect(armedPlain).toContain("[✓]");
    expect(armedPlain).not.toContain("Type something.");
    expect(armedPlain).toContain("▌");

    const filled = renderChoicePanelLines({
      header: "Focus",
      question: "Which aspects?",
      rows,
      selectedIndex: customIdx,
      cols: 100,
      multiSelect: true,
      checkedOptionIndexes: new Set(),
      customText: "彩礼费用",
      customChecked: true,
      showHeader: true,
    });
    const filledPlain = stripAnsi(filled.join("\n"));
    expect(filledPlain).toContain("彩礼费用");
    expect(filledPlain).not.toContain("Type something.");
    // Must not concatenate placeholder with typed text.
    expect(filledPlain).not.toMatch(/Type something\.\s*彩礼费用/);

    const idle = renderChoicePanelLines({
      header: "Focus",
      question: "Which aspects?",
      rows,
      selectedIndex: 0,
      cols: 100,
      multiSelect: true,
      checkedOptionIndexes: new Set(),
      customText: "",
      customChecked: false,
      showHeader: true,
    });
    const idlePlain = stripAnsi(idle.join("\n"));
    expect(idlePlain).toContain("Type something.");
    expect(idlePlain).toMatch(/\[ \].*Type something\./);
  });

  it("keeps custom text visible when checked row is not selected", () => {
    const rows = buildMultiChoiceRows([{ label: "A", description: "alpha" }]);
    const customIdx = rows.findIndex((r) => r.kind === "custom");
    const lines = renderChoicePanelLines({
      header: "Focus",
      question: "Which?",
      rows,
      selectedIndex: 0,
      cols: 80,
      multiSelect: true,
      checkedOptionIndexes: new Set([0]),
      customText: "彩礼费用",
      customChecked: true,
      showHeader: true,
    });
    const plain = stripAnsi(lines.join("\n"));
    expect(plain).toContain("彩礼费用");
    expect(plain).not.toContain("Type something.");
    expect(customIdx).toBeGreaterThan(0);
  });

  it("composes multi-select answer with custom text in parallel", () => {
    expect(
      composeMultiSelectAnswer(
        [
          { label: "A", description: "" },
          { label: "B", description: "" },
        ],
        new Set([0, 1]),
        "extra note",
      ),
    ).toBe("A, B, extra note");
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
    expect(parseChoiceInputActions(" ").actions).toEqual([{ type: "space" }]);
  });

  it("restores checked indexes from a multi-select answer string", () => {
    expect(
      [
        ...checkedIndexesFromAnswer(
          [
            { label: "A", description: "" },
            { label: "B", description: "" },
            { label: "C", description: "" },
          ],
          "A, C",
        ),
      ],
    ).toEqual([0, 2]);
  });

  it("renders wizard multi-select option checkboxes and Submit", () => {
    const rows = buildMultiChoiceRows([
      { label: "食品", description: "产品" },
      { label: "健康", description: "服务" },
    ]);
    const text = stripAnsi(
      renderQuestionWizardPanelLines({
        questions: [
          {
            header: "领域侧重",
            question: "报告最关注哪个领域？",
            options: [
              { label: "食品", description: "产品" },
              { label: "健康", description: "服务" },
            ],
            multiSelect: true,
          },
        ],
        answers: {},
        focusIndex: 0,
        rows,
        selectedIndex: 0,
        cols: 80,
        multiSelect: true,
        checkedOptionIndexes: new Set([1]),
      }).join("\n"),
    );
    expect(text).toContain("[ ]");
    expect(text).toContain("[✓]");
    expect(text).toContain("Submit");
    expect(text).toContain("可多选");
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
