import { describe, expect, it } from "vitest";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import type { ArchiveEntry, TrashEntry } from "../src/model/retention.svelte";
import {
  calendarOccurrences,
  firstTextLine,
  formatOccurrenceTime,
  localDateKey,
  monthGrid,
  occurrencesOnDay,
  visibleGridRange,
} from "../src/calendar/calendarLogic";
import { parseProjectIndex, mergeLoadedNotes, serializeProjectIndex } from "../src/project/index";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import { minimumHeightForKind, minimumWidthForKind, resizeRuleForKind } from "../src/selection/resize";

const calendar: Note = {
  id: "calendar-id", type: "calendar", name: "Calendar", text: "", x: 12, y: -4,
  width: 36, height: 34, createdAt: 1_700_000_000_000,
};

describe("Calendar logic", () => {
  it("creates Monday-first grids of at most six weeks and includes leap day", () => {
    const february = monthGrid(2024, 1, new Date(2024, 1, 10));
    expect(february[0]?.date.getDay()).toBe(1);
    expect(february).toHaveLength(35);
    expect(february.some((day) => day.key === "2024-02-29" && day.inCurrentMonth)).toBe(true);

    const sixWeeks = monthGrid(2021, 4, new Date(2021, 4, 1));
    expect(sixWeeks[0]?.date.getDay()).toBe(1);
    expect(sixWeeks).toHaveLength(42);
    expect(sixWeeks.at(-1)?.date.getDay()).toBe(0);
  });

  it("keeps the resizable Calendar at its grid-fitting minimum size", () => {
    expect(minimumWidthForKind("calendar")).toBe(36);
    expect(minimumHeightForKind("calendar")).toBe(34);
    expect(resizeRuleForKind("calendar")).toMatchObject({ width: "free", height: "free", handles: "all" });
  });

  it("buckets due times by their local day and sorts a day's reminders", () => {
    const early = new Date(2024, 4, 9, 23, 30).getTime();
    const first = new Date(2024, 4, 9, 23, 50).getTime();
    const nextDay = new Date(2024, 4, 10, 0, 10).getTime();
    const entries = [
      { timeId: "late", dueAt: first, summary: "later", targetId: "late" },
      { timeId: "early", dueAt: early, summary: "earlier", targetId: "early" },
      { timeId: "next", dueAt: nextDay, summary: "tomorrow", targetId: "next" },
    ];

    expect(occurrencesOnDay(entries, localDateKey(new Date(first))).map((item) => item.timeId)).toEqual(["early", "late"]);
    expect(occurrencesOnDay(entries, localDateKey(new Date(nextDay))).map((item) => item.timeId)).toEqual(["next"]);
    expect(formatOccurrenceTime(first)).toBe("23:50");
  });

  it("projects enabled standalone and embedded Time data and resolves linked reminder text", () => {
    const embedded: Note = {
      id: "task", type: "note", name: "Task", text: "Ship release\nmore detail", x: 0, y: 0, width: 30, height: 10,
      task: { done: false, doneAt: null },
      time: { schedule: { kind: "at", date: null, time: "09:00" }, enabled: true },
    };
    const timed: Note = {
      id: "time", type: "time", name: "Reminder", text: "", x: 0, y: 0, width: 30, height: null,
      time: { schedule: { kind: "at", date: null, time: "09:00" }, enabled: true },
    };
    const message: Note = {
      id: "message", type: "message", name: "Message", text: "Message title", x: 0, y: 0, width: 30, height: null,
      message: { sound: false, overhive: false },
    };
    const disabled: Note = {
      ...timed, id: "disabled", time: { ...timed.time!, enabled: false },
    };
    const edges: Link[] = [
      { id: "time-message", from: "time", to: "message", kind: "strong", shape: "base" },
      { id: "message-task", from: "message", to: "task", kind: "weak", shape: "base" },
    ];
    const start = new Date(2024, 2, 4, 0, 0).getTime();
    const due = new Date(2024, 2, 4, 9, 0).getTime();
    const result = calendarOccurrences([embedded, timed, message, disabled], edges, ["task", "time", "message", "disabled"], start, start + 86_400_000,
      (data) => data.enabled ? [due] : []);

    expect(result).toHaveLength(2);
    expect(result.find((item) => item.timeId === "time")).toMatchObject({ summary: "Ship release", targetId: "task" });
    expect(result.find((item) => item.timeId === "task")).toMatchObject({ summary: "Ship release", targetId: "task" });
    expect(firstTextLine(embedded)).toBe("Ship release");
    const days = monthGrid(2024, 2, new Date(2024, 2, 10));
    const range = visibleGridRange(days);
    expect(localDateKey(new Date(range.fromMs))).toBe(days[0]?.key);
    expect(new Date(range.fromMs).getHours()).toBe(0);
    expect(localDateKey(new Date(range.toMs - 1))).toBe(days.at(-1)?.key);
  });

  it("round trips the Calendar kind through project, archive, trash and clipboard serialization", () => {
    const archived: ArchiveEntry = { id: "archive-calendar", archivedAt: 10, note: { ...calendar, id: "archived-calendar" }, links: [] };
    const trashed: TrashEntry = { id: "trash-calendar", deletedAt: 11, notes: [{ ...calendar, id: "trashed-calendar" }], zones: [], links: [] };
    const index = parseProjectIndex(serializeProjectIndex([calendar], undefined, [], [], [], [], {}, [archived], [trashed]));
    expect(index.notes[0]?.type).toBe("calendar");
    const loaded = mergeLoadedNotes(index, [{
      id: calendar.id, name: calendar.name, file: index.notes[0]!.file, text: "",
      x: calendar.x, y: calendar.y, width: calendar.width, height: calendar.height,
    }]);
    expect(loaded[0]).toMatchObject({ type: "calendar", width: 36, height: 34 });

    expect(index.archive[0]?.note).toMatchObject({ id: "archived-calendar", type: "calendar" });
    expect(index.trash[0]?.notes[0]).toMatchObject({ id: "trashed-calendar", type: "calendar" });

    const copied = parseNotesPayload(serializeNotes([calendar]));
    expect(copied?.nodes[0]).toMatchObject({ type: "calendar", name: "Calendar", width: 36, height: 34 });
  });
});

it("does not project an undated repeating reminder before its node was created", async () => {
  const { calendarOccurrences } = await import("../src/calendar/calendarLogic");
  const { occurrencesBetween } = await import("../src/time/scheduler");
  const created = new Date(2026, 8, 15, 10).getTime();
  const time = { id: "t", type: "time", name: "Daily", text: "", x: 0, y: 0, width: 30, height: null, createdAt: created,
    time: { enabled: true, schedule: { kind: "at", date: null, time: "09:00" } } } as never;
  const days = calendarOccurrences([time], [], ["t"], new Date(2026, 8, 1).getTime(), new Date(2026, 9, 1).getTime(), occurrencesBetween)
    .map((item) => new Date(item.dueAt).getDate());
  expect(days[0]).toBe(15);
  expect(days).toHaveLength(16);
});
