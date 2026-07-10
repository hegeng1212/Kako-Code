import { describe, expect, it } from "vitest";
import { InputHistory, MAX_INPUT_HISTORY, mergeInputHistory } from "./input-history.js";

describe("mergeInputHistory", () => {
  it("keeps local-only slash commands between transcript prompts", () => {
    const local = ["hello", "/workflows", "next question"];
    const transcript = ["hello", "next question"];
    expect(mergeInputHistory(local, transcript)).toEqual([
      "hello",
      "/workflows",
      "next question",
    ]);
  });

  it("keeps local-only entries when transcript is empty", () => {
    expect(mergeInputHistory(["/workflows"], [])).toEqual(["/workflows"]);
  });
});

describe("InputHistory", () => {
  it("stores up to MAX_INPUT_HISTORY entries", () => {
    const history = new InputHistory();
    for (let i = 0; i < MAX_INPUT_HISTORY + 5; i++) {
      history.commit(`msg-${i}`);
    }
    expect(history.length).toBe(MAX_INPUT_HISTORY);
    expect(history.browseUp("")).toBe(`msg-${MAX_INPUT_HISTORY + 4}`);
  });

  it("browses up and down with draft restore", () => {
    const history = new InputHistory();
    history.commit("first");
    history.commit("second");

    expect(history.browseUp("draft")).toBe("second");
    expect(history.isBrowsing()).toBe(true);
    expect(history.indicatorPosition()).toBe(2);

    expect(history.browseUp("")).toBe("first");
    expect(history.indicatorPosition()).toBe(1);

    expect(history.browseDown()).toBe("second");
    expect(history.browseDown()).toBe("draft");
    expect(history.isBrowsing()).toBe(false);
  });

  it("skips duplicate consecutive commits", () => {
    const history = new InputHistory();
    history.commit("same");
    history.commit("same");
    expect(history.length).toBe(1);
  });

  it("loads full session entries without cap", () => {
    const history = new InputHistory();
    const entries = Array.from({ length: MAX_INPUT_HISTORY + 5 }, (_, i) => `msg-${i}`);
    history.loadEntries(entries);
    expect(history.length).toBe(entries.length);
    expect(history.browseUp("")).toBe(`msg-${entries.length - 1}`);
  });

  it("mergeFromTranscript preserves local-only slash commands", () => {
    const history = new InputHistory();
    history.commit("hello");
    history.commit("/workflows");
    history.commit("next question");
    history.mergeFromTranscript(["hello", "next question"]);
    expect(history.browseUp("")).toBe("next question");
    expect(history.browseUp("")).toBe("/workflows");
    expect(history.browseUp("")).toBe("hello");
  });
});
