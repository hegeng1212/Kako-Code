import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import {
  completeSlashSuggestion,
  filterSlashSuggestions,
  planSlashSuggestFooter,
  renderSlashSuggestLines,
  renderSlashInputText,
  resolveSlashSubmitValue,
  slashSuggestQuery,
  shouldShowSlashMenu,
} from "./slash-suggest.js";
import type { SystemSkillEntry } from "@kako/core";

const SKILLS: SystemSkillEntry[] = [
  {
    name: "workflows",
    handler: "skill",
    description: "Browse running and completed workflows",
  },
  {
    name: "deep-research",
    tag: "dynamic workflow",
    description:
      "Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.",
  },
  {
    name: "init",
    description: "Initialize a new KAKO.md file with codebase documentation",
  },
];

describe("slash suggest", () => {
  it("filters skills by prefix", () => {
    expect(filterSlashSuggestions("de", SKILLS).map((s) => s.name)).toEqual([
      "deep-research",
    ]);
    expect(filterSlashSuggestions("w", SKILLS).map((s) => s.name)).toEqual([
      "workflows",
    ]);
    expect(filterSlashSuggestions("", SKILLS)).toHaveLength(3);
  });

  it("parses slash query before the first space", () => {
    expect(slashSuggestQuery("/init foo", 5)).toBe("init");
    expect(slashSuggestQuery("/init foo", 8)).toBeNull();
  });

  it("keeps the menu open only while editing the command token", () => {
    expect(shouldShowSlashMenu("/", 1)).toBe(true);
    expect(shouldShowSlashMenu("/init foo", 8)).toBe(false);
  });

  it("completes slash command token with trailing space on Tab", () => {
    expect(completeSlashSuggestion("/de", SKILLS[1]!)).toBe("/deep-research ");
    expect(completeSlashSuggestion("/deep-research topic", SKILLS[1]!)).toBe(
      "/deep-research topic",
    );
  });

  it("submits selected slash command on Enter", () => {
    expect(resolveSlashSubmitValue("/", SKILLS, 0)).toBe("/workflows");
    expect(resolveSlashSubmitValue("/", SKILLS, 1)).toBe("/deep-research");
    expect(resolveSlashSubmitValue("/", SKILLS, 2)).toBe("/init");
    expect(resolveSlashSubmitValue("/de args", SKILLS, 1)).toBe("/deep-research args");
  });

  it("wraps long descriptions with continuation indent", () => {
    const lines = renderSlashSuggestLines({
      skills: [SKILLS[1]!],
      selectedIndex: 0,
      cols: 48,
    });
    expect(lines.length).toBeGreaterThan(1);
    const second = stripAnsi(lines[1]!);
    const firstDescStart = stripAnsi(lines[0]!).indexOf("[dynamic workflow]");
    const secondStart = second.search(/\S/);
    expect(secondStart).toBe(firstDescStart);
  });

  it("colors slash command in input line like selected suggest entry", () => {
    const line = renderSlashInputText("/deep-research");
    expect(stripAnsi(line)).toBe("/deep-research");
    expect(line).toContain("\x1b[38;5;117m");
    expect(line).toContain("\x1b[1m");

    const withArgs = renderSlashInputText("/deep-research topic");
    expect(stripAnsi(withArgs)).toBe("/deep-research topic");
    expect(withArgs).toContain("\x1b[38;5;117m");
    expect(withArgs).toContain("\x1b[38;5;255m");
  });

  it("uses cyan for selected command and muted for unselected", () => {
    const lines = renderSlashSuggestLines({
      skills: SKILLS,
      selectedIndex: 1,
      cols: 120,
    });
    expect(lines[0]).toContain("/workflows");
    expect(lines[0]).toContain("\x1b[38;5;245m");
    const deepLine = lines.find((line) => stripAnsi(line).includes("/deep-research"));
    expect(deepLine).toBeDefined();
    expect(deepLine).toContain("\x1b[38;5;117m");
    const initLine = lines.find((line) => stripAnsi(line).includes("/init"));
    expect(initLine).toBeDefined();
    expect(initLine).toContain("\x1b[38;5;245m");
  });

  it("keeps slash footer within a terminal budget by shrinking maxVisible", () => {
    const plan = planSlashSuggestFooter({
      skills: SKILLS,
      selectedIndex: 0,
      cols: 120,
      maxHeight: 8,
      inputFooterHeight: 4,
    });
    expect(plan.height).toBeLessThanOrEqual(8);
    expect(plan.maxVisible).toBeLessThan(3);
  });
});
