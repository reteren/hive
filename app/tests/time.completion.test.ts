import { afterEach, describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import type { Link } from "../src/model/link";
import { board, replaceBoard } from "../src/model/board.svelte";
import { replaceLinks } from "../src/model/links.svelte";
import { clear, history, undo, redo } from "../src/history/history.svelte";
import { taskLog } from "../src/tasks/taskLog.svelte";
import { toggleTaskCompletion } from "../src/tasks/taskActions.svelte";
import { linkedTaskCompletionForTime } from "../src/time/taskLink";
import { setTimeEnabled } from "../src/time/actions.svelte";
import { timeEnablePreference } from "../src/time/enablePreference.svelte";
import { DEFAULT_VIEW_SETTINGS, parseViewSettings, serializeViewSettings } from "../src/settings/viewSettings";

function note(id: string, fields: Partial<Note> = {}): Note {
  return { id, name: id, type: "note", text: "", x: 0, y: 0, width: 30, height: null, ...fields };
}
const task = (id: string, done = false) => note(id, { task: { done, doneAt: done ? 1 : null } });
const timer = (id: string, enabled = true) => note(id, { type: "time", time: {
  schedule: { kind: "interval", minutes: 5, mode: "calendar", repeat: true }, enabled,
} });
const edge = (from: string, to: string, kind: Link["kind"] = "strong"): Link => ({ id: `${from}-${to}-${kind}`, from, to, kind, shape: "base" });
afterEach(() => { replaceBoard([]); replaceLinks([]); clear(); taskLog.entries = []; timeEnablePreference.skipCompletedTimerConfirmation = false; });

describe("Task completion and timers", () => {
  it("disables a single linked timer immediately and undoes completion and disable in one step", () => {
    replaceBoard([task("task"), timer("timer")]); replaceLinks([edge("task", "timer")]); clear();
    toggleTaskCompletion("task");
    expect(board.notes.timer.time?.enabled).toBe(false);
    expect(board.notes.task.task?.done).toBe(true);
    expect(history.entries).toHaveLength(1);
    expect(taskLog.entries).toHaveLength(1);
    undo(); expect(board.notes.timer.time?.enabled).toBe(true); expect(board.notes.task.task?.done).toBe(false);
    expect(taskLog.entries).toHaveLength(0);
    redo(); expect(board.notes.timer.time?.enabled).toBe(false); expect(taskLog.entries).toHaveLength(1);
  });
  it("waits for all strong incoming tasks, ignoring weak, reverse and ordinary nodes", () => {
    replaceBoard([task("first"), task("last"), task("weak"), task("reverse"), note("ordinary"), timer("timer")]);
    replaceLinks([edge("first", "timer"), edge("last", "timer"), edge("weak", "timer", "weak"), edge("timer", "reverse"), edge("ordinary", "timer")]); clear();
    toggleTaskCompletion("first"); expect(board.notes.timer.time?.enabled).toBe(true);
    toggleTaskCompletion("last"); expect(board.notes.timer.time?.enabled).toBe(false);
    expect(history.entries).toHaveLength(2);
    undo(); expect(board.notes.last.task?.done).toBe(false); expect(board.notes.timer.time?.enabled).toBe(true);
    undo(); expect(board.notes.first.task?.done).toBe(false); expect(board.notes.timer.time?.enabled).toBe(true);
    redo(); expect(board.notes.timer.time?.enabled).toBe(true);
    redo(); expect(board.notes.timer.time?.enabled).toBe(false);
  });
  it("includes an embedded host task and counts duplicate links once", () => {
    const host = task("host"); host.time = timer("unused").time;
    replaceBoard([host, task("other")]); replaceLinks([edge("other", "host")]); clear();
    toggleTaskCompletion("host"); expect(board.notes.host.time?.enabled).toBe(true);
    toggleTaskCompletion("other"); expect(board.notes.host.time?.enabled).toBe(false);
    undo(); expect(board.notes.host.time?.enabled).toBe(true);
    expect(linkedTaskCompletionForTime("host", [edge("other", "host"), edge("other", "host")], board.notes)).toEqual({ total: 2, done: 1, allDone: false });
  });
  it("stops a task's own embedded timer immediately without needing a link", () => {
    const host = task("host"); host.time = timer("unused").time;
    replaceBoard([host]); replaceLinks([]); clear();
    toggleTaskCompletion("host"); expect(board.notes.host.time?.enabled).toBe(false);
    expect(history.entries).toHaveLength(1);
    undo(); expect(board.notes.host.time?.enabled).toBe(true); expect(board.notes.host.task?.done).toBe(false);
  });
  it("reopening a task does not enable its stopped timer or alter an already stopped timer on undo", () => {
    replaceBoard([task("task"), timer("timer", false)]); replaceLinks([edge("task", "timer")]); clear();
    toggleTaskCompletion("task"); undo(); expect(board.notes.timer.time?.enabled).toBe(false);
    redo(); toggleTaskCompletion("task"); expect(board.notes.timer.time?.enabled).toBe(false);
  });
});

describe("Enable completed-task timer confirmation", () => {
  it("requires an answer before recording any change and confirming enables with one Undo", () => {
    replaceBoard([task("task", true), timer("timer", false)]); replaceLinks([edge("task", "timer")]); clear();
    expect(setTimeEnabled("timer", true)).toBe("confirmation-required");
    expect(board.notes.timer.time?.enabled).toBe(false); expect(history.entries).toHaveLength(0);
    expect(setTimeEnabled("timer", true, true)).toBe("changed");
    expect(board.notes.timer.time?.enabled).toBe(true); expect(history.entries).toHaveLength(1);
    undo(); expect(board.notes.timer.time?.enabled).toBe(false);
  });
  it("skips the warning for an open task or no tasks and respects the remembered preference", () => {
    replaceBoard([task("task"), timer("timer", false), timer("unlinked", false)]); replaceLinks([edge("task", "timer")]); clear();
    expect(setTimeEnabled("timer", true)).toBe("changed");
    expect(setTimeEnabled("unlinked", true)).toBe("changed");
    const host = task("host", true); host.time = timer("unused", false).time;
    replaceBoard([host]); clear();
    expect(setTimeEnabled("host", true)).toBe("confirmation-required");
    timeEnablePreference.skipCompletedTimerConfirmation = true;
    expect(setTimeEnabled("host", true)).toBe("changed");
    expect(board.notes.host.time?.enabled).toBe(true);
  });
  it("persists the opt-out and treats absent or invalid legacy settings as false", () => {
    const saved = serializeViewSettings({ ...DEFAULT_VIEW_SETTINGS, skipCompletedTimerConfirmation: true });
    expect(parseViewSettings(saved, DEFAULT_VIEW_SETTINGS).skipCompletedTimerConfirmation).toBe(true);
    for (const serialized of [null, "{}", '{"skipCompletedTimerConfirmation":"yes"}']) {
      expect(parseViewSettings(serialized, DEFAULT_VIEW_SETTINGS).skipCompletedTimerConfirmation).toBe(false);
    }
  });
});
