import { describe, expect, it } from "vitest";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import {
  parseTimeCounters,
  serializeViewSettingsWithTimeCounters,
} from "../src/settings/viewSettings";
import { DEFAULT_VIEW_SETTINGS } from "../src/settings/viewSettings";
import { advanceTimeCounters, linkedMessagesForTime } from "../src/time/runtimeLogic";

describe("Time runtime support", () => {
  it("counts throttled app time and only accrues active time while focused", () => {
    const initial = { appMs: 10_000, activeMs: 4_000 };
    const focused = advanceTimeCounters(initial, 100_000, 105_500, true);
    expect(focused).toEqual({
      counters: { appMs: 15_500, activeMs: 9_500 },
      elapsedMs: 5_500,
      lastAt: 105_500,
    });

    const hidden = advanceTimeCounters(focused.counters, 105_500, 112_000, false);
    expect(hidden.counters).toEqual({ appMs: 22_000, activeMs: 9_500 });
    expect(advanceTimeCounters(hidden.counters, 112_000, 111_000, true).elapsedMs).toBe(0);
  });

  it("uses only outgoing strong links from a Time node to Message nodes", () => {
    const message = { id: "message", type: "message", text: "Reminder" } as Note;
    const ordinary = { id: "ordinary", type: "note", text: "No" } as Note;
    const notes = { message, ordinary };
    const link = (id: string, from: string, to: string, kind: Link["kind"]): Link => ({
      id, from, to, kind, shape: "base",
    });

    expect(linkedMessagesForTime("time", notes, [
      link("out", "time", "message", "strong"),
      link("in", "message", "time", "strong"),
      link("weak", "time", "message", "weak"),
      link("other", "time", "ordinary", "strong"),
    ])).toEqual([message]);
  });

  it("stores validated counters beside app-level view settings", () => {
    const serialized = serializeViewSettingsWithTimeCounters(DEFAULT_VIEW_SETTINGS, {
      appMs: 98_765,
      activeMs: 12_345,
    });
    expect(parseTimeCounters(serialized)).toEqual({ appMs: 98_765, activeMs: 12_345 });
    expect(parseTimeCounters('{"timeCounters":{"appMs":-1,"activeMs":"soon"}}'))
      .toEqual({ appMs: 0, activeMs: 0 });
  });
});
