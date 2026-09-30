import { describe, expect, it } from "vitest";
import { formatStopwatch, stopwatchElapsedMs, toggleManualStopwatch } from "../src/time/stopwatchLogic";
import { firstLinkedTaskForTime } from "../src/time/taskLink";
import { parseStopwatchData } from "../src/time/data";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import type { StopwatchData } from "../src/time/types";

describe("Time stopwatch calculations", () => {
  const counters = { appMs: 90_000, activeMs: 30_000 };

  it("counts from project/node creation or from project-scoped app/focus counters", () => {
    const common = { noteCreatedAt: 20_000, projectCreatedAt: 10_000, sessionStartedAt: 25_000, linkedTask: null, counters, now: 65_000 };
    expect(stopwatchElapsedMs({ ...common, mode: "project", stopwatch: { mode: "project" } })).toBe(55_000);
    expect(stopwatchElapsedMs({ ...common, mode: "node", stopwatch: { mode: "node" } })).toBe(45_000);
    expect(stopwatchElapsedMs({ ...common, mode: "active", stopwatch: { mode: "active", nodeCreatedActiveMs: 8_000 } })).toBe(22_000);
    expect(stopwatchElapsedMs({ ...common, mode: "active", stopwatch: { mode: "active", includeProjectTime: true } })).toBe(30_000);
    expect(stopwatchElapsedMs({ ...common, mode: "app", stopwatch: { mode: "app", nodeCreatedAppMs: 15_000 } })).toBe(75_000);
    expect(stopwatchElapsedMs({ ...common, mode: "app", stopwatch: { mode: "app", includeProjectTime: true } })).toBe(90_000);
  });

  it("accumulates manual runs across stops and resumes", () => {
    const running: StopwatchData = { mode: "manual", running: true, elapsedMs: 5_000, startedAt: 10_000 };
    const stopped = toggleManualStopwatch(running, 18_500);
    expect(stopped).toMatchObject({ mode: "manual", running: false, elapsedMs: 13_500 });
    expect(stopwatchElapsedMs({
      mode: "manual", noteCreatedAt: 0, projectCreatedAt: 0, sessionStartedAt: null, linkedTask: null, counters, stopwatch: stopped, now: 99_000,
    })).toBe(13_500);
    const resumed = toggleManualStopwatch(stopped, 40_000);
    expect(stopwatchElapsedMs({
      mode: "manual", noteCreatedAt: 0, projectCreatedAt: 0, sessionStartedAt: null, linkedTask: null, counters, stopwatch: resumed, now: 42_000,
    })).toBe(15_500);
  });

  it("formats day/hour/minute/second counters", () => {
    expect(formatStopwatch(3 * 86_400_000 + 4 * 3_600_000 + 5 * 60_000 + 6_000))
      .toEqual({ days: 3, hours: "04", minutes: "05", seconds: "06" });
  });

  it("counts from the process session and has no value before runtime starts", () => {
    const input = { mode: "session" as const, noteCreatedAt: 0, projectCreatedAt: 0, linkedTask: null, counters, stopwatch: { mode: "session" as const }, now: 65_000 };
    expect(stopwatchElapsedMs({ ...input, sessionStartedAt: 25_000 })).toBe(40_000);
    expect(stopwatchElapsedMs({ ...input, sessionStartedAt: null })).toBeNull();
  });

  it("switches to the first strongly linked task, follows completion and reopening", () => {
    const task = (id: string, createdAt: number, doneAt: number | null): Note => ({
      id, type: "note", name: id, text: "", x: 0, y: 0, width: 30, height: null,
      createdAt, task: { done: doneAt !== null, doneAt },
    });
    const first = task("first", 10_000, null);
    const second = task("second", 20_000, 40_000);
    const notes = { first, second };
    const edge = (id: string, from: string, to: string, kind: Link["kind"] = "strong"): Link => ({ id, from, to, kind, shape: "base" });
    let edges = [edge("one", "time", "second"), edge("two", "first", "time")];
    const linked = () => firstLinkedTaskForTime("time", edges, notes, ["first", "second"]);
    const elapsed = (mode: "taskCreated" | "taskDone") => stopwatchElapsedMs({
      mode, noteCreatedAt: 0, projectCreatedAt: 0, sessionStartedAt: null,
      linkedTask: linked() ? { createdAt: linked()?.createdAt, doneAt: linked()?.task?.doneAt ?? null } : null,
      counters, stopwatch: { mode }, now: 65_000,
    });
    expect(linked()).toBe(first);
    expect(elapsed("taskCreated")).toBe(55_000);
    expect(elapsed("taskDone")).toBeNull();
    first.task!.doneAt = 45_000;
    first.task!.done = true;
    expect(elapsed("taskDone")).toBe(20_000);
    first.task!.doneAt = null;
    first.task!.done = false;
    expect(elapsed("taskDone")).toBeNull();
    edges = [edge("one", "time", "second"), edge("weak", "first", "time", "weak")];
    expect(linked()).toBe(second);
    expect(elapsed("taskCreated")).toBe(45_000);
    expect(elapsed("taskDone")).toBe(25_000);
    edges = [];
    expect(linked()).toBeNull();
    expect(elapsed("taskCreated")).toBeNull();
    expect(elapsed("taskDone")).toBeNull();
  });

  it("accepts all session modes from persisted data and rejects unknown modes", () => {
    for (const mode of ["session", "taskCreated", "taskDone"]) {
      expect(parseStopwatchData({ mode })).toEqual({ mode });
    }
    expect(parseStopwatchData({ mode: "future" })).toBeNull();
  });
});
