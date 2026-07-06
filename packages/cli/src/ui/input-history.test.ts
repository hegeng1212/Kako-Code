import { describe, expect, it } from "vitest";
import { InputHistory, MAX_INPUT_HISTORY } from "./input-history.js";

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
});
