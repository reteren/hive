import { describe, expect, it } from "vitest";
import { evaluateTime, nextDueAt, startRuntime, validateSchedule, type TimeContext } from "../src/time/scheduler";
import type { TimeNodeData, TimeSchedule } from "../src/time/types";

const at = (date: string, time: string): number => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute).getTime();
};

function context(now: number, appMs = 0, activeMs = 0): TimeContext {
  return { now, appMs, activeMs };
}

function timeNode(schedule: TimeSchedule, runtime?: TimeNodeData["runtime"], enabled = true): TimeNodeData {
  return { schedule, runtime, enabled };
}

describe("time scheduler", () => {
  it("validates required local times, optional real dates, and positive intervals", () => {
    expect(validateSchedule({ kind: "at", date: null, time: "09:05" })).toBeNull();
    expect(validateSchedule({ kind: "at", date: "2028-02-29", time: "23:59" })).toBeNull();
    expect(validateSchedule({ kind: "at", date: "2027-02-29", time: "23:59" })).toContain("date");
    expect(validateSchedule({ kind: "at", date: null, time: "24:00" })).toContain("time");
    expect(validateSchedule({ kind: "interval", minutes: 1, mode: "calendar", repeat: false })).toBeNull();
    expect(validateSchedule({ kind: "interval", minutes: 0.5, mode: "active", repeat: true })).toContain("1 minute");
  });

  it("keeps a disabled reminder stopped without firing or exposing a next due time", () => {
    const schedule: TimeSchedule = { kind: "interval", minutes: 1, mode: "calendar", repeat: true };
    const data = timeNode(schedule, { intervalStartedAt: 1_000, lastCheckedAt: 1_000 }, false);
    expect(evaluateTime(data, context(61_000)).fire).toBeNull();
    expect(nextDueAt(data, context(61_000))).toBeNull();
  });

  it("fires a dated local-time occurrence once", () => {
    const dueAt = at("2026-10-05", "09:15");
    const schedule: TimeSchedule = { kind: "at", date: "2026-10-05", time: "09:15" };
    const runtime = startRuntime(schedule, context(dueAt - 1_000));
    const result = evaluateTime(timeNode(schedule, runtime), context(dueAt));

    expect(result.fire).toEqual({ key: "2026-10-05T09:15", dueAt, overlate: false });
    expect(evaluateTime(timeNode(schedule, result.runtime), context(dueAt + 1_000)).fire).toBeNull();
    expect(nextDueAt(timeNode(schedule, result.runtime), context(dueAt + 1_000))).toBeNull();
  });

  it("does not fire a one-shot that was already past when its runtime started", () => {
    const dueAt = at("2026-10-05", "09:15");
    const now = dueAt + 3 * 60 * 60_000;
    const schedule: TimeSchedule = { kind: "at", date: "2026-10-05", time: "09:15" };
    const runtime = startRuntime(schedule, context(now));

    expect(evaluateTime(timeNode(schedule, runtime), context(now + 5_000)).fire).toBeNull();
    expect(nextDueAt(timeNode(schedule, runtime), context(now))).toBeNull();
  });

  it("fires daily at local midnight boundaries and advances by calendar date", () => {
    const schedule: TimeSchedule = { kind: "at", date: null, time: "23:59" };
    const firstDue = at("2026-10-05", "23:59");
    const runtime = startRuntime(schedule, context(firstDue - 60_000));
    const first = evaluateTime(timeNode(schedule, runtime), context(firstDue));
    const nextDay = at("2026-10-06", "23:59");

    expect(first.fire?.key).toBe("2026-10-05T23:59");
    expect(nextDueAt(timeNode(schedule, first.runtime), context(firstDue + 1_000))).toBe(nextDay);
    expect(evaluateTime(timeNode(schedule, first.runtime), context(nextDay)).fire?.key).toBe("2026-10-06T23:59");
  });

  it("coalesces several missed daily occurrences into only the latest, marked late", () => {
    const schedule: TimeSchedule = { kind: "at", date: null, time: "09:00" };
    const startedAt = at("2026-10-01", "08:00");
    const runtime = startRuntime(schedule, context(startedAt));
    const latestDue = at("2026-10-04", "09:00");
    const result = evaluateTime(timeNode(schedule, runtime), context(latestDue));

    expect(result.fire).toEqual({ key: "2026-10-04T09:00", dueAt: latestDue, overlate: true });
    expect(evaluateTime(timeNode(schedule, result.runtime), context(latestDue + 1_000)).fire).toBeNull();
  });

  it("does not duplicate a daily occurrence after the wall clock moves backward", () => {
    const schedule: TimeSchedule = { kind: "at", date: null, time: "09:00" };
    const due = at("2026-10-05", "09:00");
    const runtime = startRuntime(schedule, context(due - 1_000));
    const fired = evaluateTime(timeNode(schedule, runtime), context(due));

    expect(fired.fire?.key).toBe("2026-10-05T09:00");
    expect(evaluateTime(timeNode(schedule, fired.runtime), context(due - 10 * 60_000)).fire).toBeNull();
    expect(evaluateTime(timeNode(schedule, fired.runtime), context(due + 2 * 60_000)).fire).toBeNull();
  });

  it("uses local Date arithmetic through spring and fall DST transitions", () => {
    const nodeProcess = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process;
    if (!nodeProcess) return;
    const previousZone = nodeProcess.env.TZ;
    nodeProcess.env.TZ = "America/New_York";
    try {
      const daily: TimeSchedule = { kind: "at", date: null, time: "02:30" };
      const march7 = at("2026-03-07", "02:30");
      const beforeStart = startRuntime(daily, context(march7 - 60_000));
      const first = evaluateTime(timeNode(daily, beforeStart), context(march7));
      const springDue = evaluateTime(timeNode(daily, first.runtime), context(at("2026-03-08", "03:30")));

      expect(springDue.fire?.key).toBe("2026-03-08T02:30");
      expect(new Date(springDue.fire!.dueAt).getHours()).toBe(3); // Native local Date normalization for the missing 02:30.

      const fallDaily: TimeSchedule = { kind: "at", date: null, time: "01:30" };
      const oct31 = at("2026-10-31", "01:29");
      const fallRuntime = startRuntime(fallDaily, context(oct31));
      const firstFold = at("2026-11-01", "01:30");
      const firstFallFire = evaluateTime(timeNode(fallDaily, fallRuntime), context(firstFold));
      const secondFold = firstFold + 60 * 60_000;

      expect(firstFallFire.fire?.key).toBe("2026-11-01T01:30");
      expect(evaluateTime(timeNode(fallDaily, firstFallFire.runtime), context(secondFold)).fire).toBeNull();
    } finally {
      if (previousZone === undefined) delete nodeProcess.env.TZ;
      else nodeProcess.env.TZ = previousZone;
    }
  });

  it("starts interval runtimes in the selected clock and estimates their due time", () => {
    const schedule: TimeSchedule = { kind: "interval", minutes: 2, mode: "app", repeat: false };
    const now = at("2026-10-05", "10:00");
    const runtime = startRuntime(schedule, context(now, 50_000, 20_000));

    expect(runtime.countedMs).toBe(50_000);
    expect(nextDueAt(timeNode(schedule, runtime), context(now, 50_000, 20_000))).toBe(now + 120_000);
  });

  it("fires repeated calendar intervals once after a long sleep and restarts from the firing moment", () => {
    const schedule: TimeSchedule = { kind: "interval", minutes: 10, mode: "calendar", repeat: true };
    const startedAt = at("2026-10-05", "10:00");
    const runtime = startRuntime(schedule, context(startedAt));
    const firedAt = startedAt + 35 * 60_000;
    const first = evaluateTime(timeNode(schedule, runtime), context(firedAt));

    expect(first.fire).toEqual({
      key: `interval:calendar:${startedAt}:3`,
      dueAt: startedAt + 30 * 60_000,
      overlate: true,
    });
    expect(first.runtime.intervalStartedAt).toBe(firedAt);
    expect(nextDueAt(timeNode(schedule, first.runtime), context(firedAt))).toBe(firedAt + 10 * 60_000);
    expect(evaluateTime(timeNode(schedule, first.runtime), context(firedAt + 1_000)).fire).toBeNull();
  });

  it("fires a non-repeating interval only once", () => {
    const schedule: TimeSchedule = { kind: "interval", minutes: 1, mode: "calendar", repeat: false };
    const startedAt = at("2026-10-05", "10:00");
    const runtime = startRuntime(schedule, context(startedAt));
    const dueAt = startedAt + 60_000;
    const justBefore = evaluateTime(timeNode(schedule, runtime), context(dueAt - 1_000));
    const first = evaluateTime(timeNode(schedule, justBefore.runtime), context(dueAt));

    expect(first.fire?.dueAt).toBe(dueAt);
    expect(first.fire?.overlate).toBe(false);
    expect(evaluateTime(timeNode(schedule, first.runtime), context(dueAt + 60_000)).fire).toBeNull();
    expect(nextDueAt(timeNode(schedule, first.runtime), context(dueAt + 60_000))).toBeNull();
  });

  it("counts app and active intervals from their respective monotonic totals", () => {
    const baseNow = at("2026-10-05", "10:00");
    const appSchedule: TimeSchedule = { kind: "interval", minutes: 1, mode: "app", repeat: false };
    const appRuntime = startRuntime(appSchedule, context(baseNow, 10_000, 5_000));
    const appBefore = evaluateTime(timeNode(appSchedule, appRuntime), context(baseNow + 60_000, 69_000, 5_000));
    expect(appBefore.fire).toBeNull();
    const appFired = evaluateTime(timeNode(appSchedule, appBefore.runtime), context(baseNow + 61_000, 70_000, 5_000));
    expect(appFired.fire?.key).toBe("interval:app:10000:1");

    const activeSchedule: TimeSchedule = { kind: "interval", minutes: 1, mode: "active", repeat: false };
    const activeRuntime = startRuntime(activeSchedule, context(baseNow, 10_000, 5_000));
    const inactive = evaluateTime(timeNode(activeSchedule, activeRuntime), context(baseNow + 5 * 60_000, 310_000, 5_000));
    expect(inactive.fire).toBeNull();
    const activeBefore = evaluateTime(timeNode(activeSchedule, inactive.runtime), context(baseNow + 5 * 60_000 + 60_000, 370_000, 64_000));
    expect(activeBefore.fire).toBeNull();
    const activeFired = evaluateTime(timeNode(activeSchedule, activeBefore.runtime), context(baseNow + 5 * 60_000 + 61_000, 371_000, 65_000));
    expect(activeFired.fire?.key).toBe("interval:active:5000:1");
  });

  it("restarts the interval baseline when a schedule is explicitly started again", () => {
    const schedule: TimeSchedule = { kind: "interval", minutes: 5, mode: "calendar", repeat: false };
    const restartedAt = at("2026-10-05", "11:00");
    expect(startRuntime(schedule, context(restartedAt))).toEqual({
      intervalStartedAt: restartedAt,
      lastCheckedAt: restartedAt,
    });
  });
});
