import { describe, expect, it } from "vitest";
import { isFixedSizeNodeKind, hasResizeHandle, RESIZE_EDGES } from "../src/selection/resize";
import { defaultAtTimeSchedule, formatCountdown, intervalHoursHint, timeCheckboxId } from "../src/time/uiSchedule";
import { moveSelectIndex, selectKeyboardAction } from "../src/time/selectLogic";

describe("Time node UI helpers", () => {
  it("defaults to one hour ahead on a five-minute boundary without a date", () => {
    const now = new Date(2026, 8, 28, 12, 2, 42).getTime();
    expect(defaultAtTimeSchedule(now)).toEqual({ kind: "at", date: null, time: "13:05" });
  });

  it("shows compact interval hours and countdowns", () => {
    expect(intervalHoursHint(45)).toBe("45 minutes");
    expect(intervalHoursHint(60)).toBe("1 hour");
    expect(intervalHoursHint(95)).toBe("1 h 35 min");
    expect(formatCountdown(3_601_001)).toBe("1h 1m");
    expect(formatCountdown(66_001)).toBe("1m 7s");
  });

  it("keeps Repeat and Enabled ids distinct within and across Time nodes", () => {
    expect(timeCheckboxId("first", "repeat")).not.toBe(timeCheckboxId("first", "enabled"));
    expect(timeCheckboxId("first", "repeat")).not.toBe(timeCheckboxId("second", "repeat"));
    expect(timeCheckboxId("node with spaces", "enabled")).toBe("time-node%20with%20spaces-enabled");
  });

  it("supports Arrow, Enter and Escape selection keys with wraparound", () => {
    expect(selectKeyboardAction("ArrowDown", false)).toBe("open");
    expect(selectKeyboardAction("ArrowUp", false)).toBe("open");
    expect(selectKeyboardAction("ArrowDown", true)).toBe("down");
    expect(selectKeyboardAction("ArrowUp", true)).toBe("up");
    expect(selectKeyboardAction("Enter", true)).toBe("select");
    expect(selectKeyboardAction("Escape", true)).toBe("close");
    expect(moveSelectIndex(2, 1, 3)).toBe(0);
    expect(moveSelectIndex(0, -1, 3)).toBe(2);
    expect(moveSelectIndex(0, 1, 0)).toBe(-1);
  });

  it("keeps Time width fixed and only allows Shift-scale handles", () => {
    expect(isFixedSizeNodeKind("time")).toBe(true);
    expect(RESIZE_EDGES.every((edge) => !hasResizeHandle("time", edge))).toBe(true);
  });
});
