import { describe, expect, it } from "vitest";
import { formatStopwatch, stopwatchElapsedMs, toggleManualStopwatch } from "../src/time/stopwatchLogic";
import type { StopwatchData } from "../src/time/types";

describe("Time stopwatch calculations", () => {
  const counters = { appMs: 90_000, activeMs: 30_000 };

  it("counts from project/node creation or from project-scoped app/focus counters", () => {
    const common = { noteCreatedAt: 20_000, projectCreatedAt: 10_000, counters, now: 65_000 };
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
      mode: "manual", noteCreatedAt: 0, projectCreatedAt: 0, counters, stopwatch: stopped, now: 99_000,
    })).toBe(13_500);
    const resumed = toggleManualStopwatch(stopped, 40_000);
    expect(stopwatchElapsedMs({
      mode: "manual", noteCreatedAt: 0, projectCreatedAt: 0, counters, stopwatch: resumed, now: 42_000,
    })).toBe(15_500);
  });

  it("formats day/hour/minute/second counters", () => {
    expect(formatStopwatch(3 * 86_400_000 + 4 * 3_600_000 + 5 * 60_000 + 6_000))
      .toEqual({ days: 3, hours: "04", minutes: "05", seconds: "06" });
  });
});
