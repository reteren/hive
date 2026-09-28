import { describe, expect, it } from "vitest";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import { hasLinkedTaskForTime, linkedTimeStatesForTask } from "../src/time/taskLink";

function edge(id: string, from: string, to: string, kind: Link["kind"] = "strong"): Link {
  return { id, from, to, kind, shape: "base" };
}

describe("task to Time links", () => {
  it("reads only outgoing strong links to Time nodes and supports several reminders", () => {
    const notes: Record<string, Note> = {
      task: {
        id: "task", type: "note", name: "Task", text: "", x: 0, y: 0, width: 30, height: null,
        task: { done: false, doneAt: null },
      },
      active: {
        id: "active", type: "time", name: "Active", text: "", x: 0, y: 0, width: 30, height: null,
        time: { schedule: { kind: "interval", minutes: 5, mode: "calendar", repeat: true }, enabled: true },
      },
      stopped: {
        id: "stopped", type: "time", name: "Stopped", text: "", x: 0, y: 0, width: 30, height: null,
        time: { schedule: { kind: "at", date: null, time: "09:00" }, enabled: false },
      },
      message: { id: "message", type: "message", name: "Message", text: "", x: 0, y: 0, width: 30, height: null },
    };

    expect(linkedTimeStatesForTask("task", [
      edge("active", "task", "active"),
      edge("stopped", "task", "stopped"),
      edge("weak", "task", "message", "weak"),
      edge("reverse", "active", "task"),
    ], notes)).toEqual([
      { noteId: "active", enabled: true },
      { noteId: "stopped", enabled: false },
    ]);
    expect(hasLinkedTaskForTime("active", [edge("active", "task", "active")], notes)).toBe(true);
    expect(hasLinkedTaskForTime("active", [edge("weak", "task", "active", "weak")], notes)).toBe(false);
    expect(hasLinkedTaskForTime("task", [edge("reverse", "task", "active")], notes)).toBe(false);
  });
});
