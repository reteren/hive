import { afterEach, describe, expect, it } from "vitest";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { replaceBoard, board } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import { pickFromList } from "../src/random/actions.svelte";
import { emitTimeActivation } from "../src/time/activation.svelte";
import { activationSourcesForTime, manualStopwatchTargets } from "../src/time/activationLogic";

function note(id: string, type: Note["type"]): Note {
  return { id, type, name: id, text: "", x: 0, y: 0, width: 30, height: null };
}

afterEach(() => { clear(); replaceBoard([]); replaceLinks([]); });

describe("stopwatch activation links", () => {
  it("lists only incoming strong Random Choice links and deduplicates their source", () => {
    const random = note("random", "random");
    const weakRandom = note("weak-random", "random");
    const ordinary = note("ordinary", "note");
    const time = note("time", "time");
    const notes = { random, "weak-random": weakRandom, ordinary, time };
    const links = [
      { id: "strong", from: "random", to: "time", kind: "strong" as const, shape: "base" as const },
      { id: "duplicate", from: "random", to: "time", kind: "strong" as const, shape: "base" as const },
      { id: "weak", from: "weak-random", to: "time", kind: "weak" as const, shape: "base" as const },
      { id: "ordinary", from: "ordinary", to: "time", kind: "strong" as const, shape: "base" as const },
    ];
    expect(activationSourcesForTime("time", notes, links).map(({ id }) => id)).toEqual(["random"]);
  });

  it("toggles linked manual stopwatches and returns one rollback for the activation command", () => {
    const random = note("random", "random");
    const time = note("time", "time");
    time.time = {
      schedule: { kind: "at", time: "12:00", date: null }, enabled: true,
      stopwatch: { mode: "manual", running: false, elapsedMs: 2_000, nodeCreatedAppMs: 0, nodeCreatedActiveMs: 0 },
    };
    const other = note("other", "time");
    other.time = { ...time.time, stopwatch: { mode: "project", running: false } };
    replaceBoard([random, time, other]);
    replaceLinks([
      { id: "activation", from: "random", to: "time", kind: "strong", shape: "base" },
      { id: "ignored", from: "random", to: "other", kind: "strong", shape: "base" },
    ]);

    expect(manualStopwatchTargets("random", board.notes, Object.values(links.byId)).map(({ id }) => id)).toEqual(["time"]);
    const rollback = emitTimeActivation("random", 50_000);
    expect(board.notes.time?.time?.stopwatch).toMatchObject({ running: true, elapsedMs: 2_000, startedAt: 50_000 });
    rollback();
    expect(board.notes.time?.time?.stopwatch).toMatchObject({ running: false, elapsedMs: 2_000 });
  });

  it("treats Random Choice firing as part of its single Undo/Redo step", () => {
    const list = note("list", "list");
    list.listItems = [{ id: "row", targetId: null, label: "Choice" }];
    const random = note("random", "random");
    const time = note("time", "time");
    time.time = {
      schedule: { kind: "at", time: "12:00", date: null }, enabled: true,
      stopwatch: { mode: "manual", running: false, elapsedMs: 0, nodeCreatedAppMs: 0, nodeCreatedActiveMs: 0 },
    };
    replaceBoard([list, random, time]);
    replaceLinks([
      { id: "source", from: "list", to: "random", kind: "strong", shape: "base" },
      { id: "activation", from: "random", to: "time", kind: "strong", shape: "base" },
    ]);

    expect(pickFromList("random", () => 0, 55_000).ok).toBe(true);
    expect(history.entries).toHaveLength(1);
    expect(board.notes.time?.time?.stopwatch).toMatchObject({ running: true, startedAt: 55_000 });
    undo();
    expect(board.notes.random?.randomPick).toBeUndefined();
    expect(board.notes.time?.time?.stopwatch).toMatchObject({ running: false });
    redo();
    expect(board.notes.random?.randomPick?.pickedAt).toBe(55_000);
    expect(board.notes.time?.time?.stopwatch).toMatchObject({ running: true, startedAt: 55_000 });
  });
});
