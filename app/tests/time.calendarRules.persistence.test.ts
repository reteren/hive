import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { parseNotesPayload, serializeNotes } from "../src/clipboard/payload";
import { mergeLoadedNotes, parseProjectIndex, parseProjectIndexWithWarnings, serializeProjectIndex } from "../src/project/index";
import { sanitizeTrashEntries } from "../src/trash/serialization";
import { copyTimeNodeData, parseCalendarRule } from "../src/time/data";
import { copyTimeSchedule } from "../src/time/uiSchedule";
import type { TimeNodeData } from "../src/time/types";

const weekly: TimeNodeData = {
  schedule: { kind: "at", date: "2026-10-01", time: "09:15", rule: { type: "weekly", days: [1, 3, 5] } },
  enabled: true,
};

function timeNote(id: string, time: TimeNodeData = weekly): Note {
  return {
    id,
    type: "time",
    name: `Reminder ${id}`,
    text: "",
    x: 1,
    y: 2,
    width: 36,
    height: null,
    time,
  };
}

describe("calendar repeat rule persistence", () => {
  it("distinguishes absent and invalid rules and validates each shape", () => {
    expect(parseCalendarRule(undefined)).toBeUndefined();
    expect(parseCalendarRule(null)).toBeNull();
    expect(parseCalendarRule({ type: "weekly", days: [] })).toBeNull();
    expect(parseCalendarRule({ type: "weekly", days: [0, 0] })).toBeNull();
    expect(parseCalendarRule({ type: "weekly", days: [0, 6] })).toEqual({ type: "weekly", days: [0, 6] });
    expect(parseCalendarRule({ type: "workdays" })).toEqual({ type: "workdays" });
    expect(parseCalendarRule({ type: "monthly", day: 31 })).toEqual({ type: "monthly", day: 31 });
    expect(parseCalendarRule({ type: "monthly", day: 0 })).toBeNull();
    expect(parseCalendarRule({ type: "yearly", month: 2, day: 29 })).toEqual({ type: "yearly", month: 2, day: 29 });
    expect(parseCalendarRule({ type: "yearly", month: 4, day: 31 })).toBeNull();
  });

  it("deep-copies weekly days in time schedule and node data copies", () => {
    const originalSchedule = weekly.schedule;
    if (originalSchedule.kind !== "at" || originalSchedule.rule?.type !== "weekly") throw new Error("Expected weekly schedule.");
    const scheduleCopy = copyTimeSchedule(originalSchedule);
    const nodeCopy = copyTimeNodeData(weekly);
    if (scheduleCopy.kind !== "at" || scheduleCopy.rule?.type !== "weekly" ||
      nodeCopy.schedule.kind !== "at" || nodeCopy.schedule.rule?.type !== "weekly") throw new Error("Expected weekly copies.");

    scheduleCopy.rule.days.push(0);
    nodeCopy.schedule.rule.days.push(2);
    expect(originalSchedule.rule.days).toEqual([1, 3, 5]);
    expect(weekly.schedule.kind === "at" && weekly.schedule.rule?.type === "weekly" ? weekly.schedule.rule.days : [])
      .toEqual([1, 3, 5]);
  });

  it("round-trips repeat rules through project, archive, trash and clipboard parsers", () => {
    const note = timeNote("weekly");
    const serialized = serializeProjectIndex([note]);
    const project = parseProjectIndex(serialized);
    expect(project.notes[0]?.time?.schedule).toEqual(weekly.schedule);
    const loaded = mergeLoadedNotes(project, [{
      id: note.id,
      name: note.name,
      file: project.notes[0]!.file,
      text: "",
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
    }]);
    expect(loaded[0]?.time?.schedule).toEqual(weekly.schedule);

    const archive = sanitizeArchiveEntries([{ id: "archive", archivedAt: 1, note, links: [] }]);
    expect(archive.warnings).toEqual([]);
    expect(archive.entries[0]?.note.time?.schedule).toEqual(weekly.schedule);

    const trash = sanitizeTrashEntries([{ id: "trash", deletedAt: 1, notes: [note], zones: [], links: [] }]);
    expect(trash.warnings).toEqual([]);
    expect(trash.entries[0]?.notes[0]?.time?.schedule).toEqual(weekly.schedule);

    const clipboard = parseNotesPayload(serializeNotes([note]));
    expect(clipboard?.nodes[0]?.time?.schedule).toEqual(weekly.schedule);
  });

  it("rejects invalid calendar rules from every persisted time parser", () => {
    const projectPayload = JSON.parse(serializeProjectIndex([timeNote("invalid-project")])) as Record<string, unknown>;
    const projectNotes = projectPayload.notes as Array<{ time: { schedule: Record<string, unknown> } }>;
    projectNotes[0]!.time.schedule.rule = { type: "weekly", days: [] };
    const project = parseProjectIndexWithWarnings(JSON.stringify(projectPayload));
    expect(project.index.notes[0]?.time).toBeUndefined();
    expect(project.warnings.length).toBeGreaterThan(0);

    const invalid = timeNote("invalid", {
      ...weekly,
      schedule: { kind: "at", date: null, time: "09:15", rule: { type: "monthly", day: 32 } },
    });
    const archive = sanitizeArchiveEntries([{ id: "archive-invalid", archivedAt: 1, note: invalid, links: [] }]);
    expect(archive.entries).toHaveLength(0);
    expect(archive.warnings.length).toBeGreaterThan(0);
    const trash = sanitizeTrashEntries([{ id: "trash-invalid", deletedAt: 1, notes: [invalid], zones: [], links: [] }]);
    expect(trash.entries).toHaveLength(0);
    expect(trash.warnings.length).toBeGreaterThan(0);
    expect(parseNotesPayload(serializeNotes([invalid]))).toBeNull();
  });
});
