import { describe, expect, it } from "vitest";
import {
  ATTENTION_CELL,
  OUTSIDE_ZONES,
  attentionDayKey,
  attentionPercent,
  parseAttentionLog,
  pruneAttention,
  recordAttention,
  summarizeAttention,
  type AttentionLog,
} from "../src/attention/logic";

describe("attention map", () => {
  it("accumulates seconds per heat cell, zone and day", () => {
    const log: AttentionLog = {};
    recordAttention(log, "2026-10-29", { x: 5, y: 5 }, "z1", 1);
    recordAttention(log, "2026-10-29", { x: 10, y: 30 }, "z1", 1);
    recordAttention(log, "2026-10-29", { x: -5, y: ATTENTION_CELL + 1 }, OUTSIDE_ZONES, 1);
    recordAttention(log, "2026-10-29", { x: Number.NaN, y: 0 }, "z1", 1);
    expect(log["2026-10-29"]).toEqual({ cells: { "0,0": 2, "-1,1": 1 }, zones: { z1: 2, "": 1 }, total: 3 });
  });

  it("summarizes a period of local days and keeps percentages whole", () => {
    const now = new Date(2026, 9, 29, 12);
    const log: AttentionLog = {};
    recordAttention(log, attentionDayKey(now), { x: 0, y: 0 }, "z1", 30);
    recordAttention(log, "2026-10-25", { x: 0, y: 0 }, "z2", 10);
    recordAttention(log, "2026-09-01", { x: 100, y: 0 }, "z2", 60);
    expect(summarizeAttention(log, "today", now)).toMatchObject({ total: 30, zones: { z1: 30 }, maxCell: 30 });
    expect(summarizeAttention(log, "week", now).total).toBe(40);
    expect(summarizeAttention(log, "month", now).total).toBe(40);
    const all = summarizeAttention(log, "all", now);
    expect(all.total).toBe(100);
    expect(all.cells).toHaveLength(2);
    expect(attentionPercent(all.zones.z2, all.total)).toBe(70);
    expect(attentionPercent(5, 0)).toBe(0);
  });

  it("drops old days and parses stored data tolerantly", () => {
    const log: AttentionLog = { "2026-01-01": { cells: {}, zones: {}, total: 1 }, "2026-10-28": { cells: {}, zones: {}, total: 2 } };
    pruneAttention(log, new Date(2026, 9, 29), 30);
    expect(Object.keys(log)).toEqual(["2026-10-28"]);
    expect(parseAttentionLog({ bad: {}, "2026-10-29": { cells: { "0,0": 3, x: "no", y: -1 }, zones: { z: 3 }, total: 3 } }))
      .toEqual({ "2026-10-29": { cells: { "0,0": 3 }, zones: { z: 3 }, total: 3 } });
    expect(parseAttentionLog("junk")).toEqual({});
  });
});
