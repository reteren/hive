import { afterEach, describe, expect, it } from "vitest";
import { fittedListStatisticsWidth, listStatisticsWidth, widthWithListStatistics, geometryFromListStatisticsFrame, listStatisticsFrameLimits, listExtensionGeometry } from "../src/stats/listStatsLayout";
import { listStatisticsMeasurements } from "../src/stats/listStatsMeasurements.svelte";
import { formatListStatisticsTotal, totalListStatistics, type ListRowStatistics } from "../src/stats/listStatistics";
import { raiseMovingCards } from "../src/stats/movingCards";
import type { Note } from "../src/model/note";
import { serializeProjectIndex, parseProjectIndex } from "../src/project/index";

const list: Note = { id: "fit-list", type: "list", name: "List", text: "", x: 10, y: 20, width: 30, height: null, listStats: true };
afterEach(() => { delete listStatisticsMeasurements[list.id]; });

describe("Statistics panel width", () => {
  it("fits natural row/total text plus padding, grows and shrinks independently of saved List width", () => {
    expect(fittedListStatisticsWidth(0)).toBe(12);
    expect(fittedListStatisticsWidth(100)).toBe(12);
    expect(fittedListStatisticsWidth(218)).toBe(21.9);
    expect(listStatisticsWidth(list)).toBe(12);
    listStatisticsMeasurements[list.id] = fittedListStatisticsWidth(218);
    expect(widthWithListStatistics(list)).toBe(51.9);
    listStatisticsMeasurements[list.id] = fittedListStatisticsWidth(145);
    expect(widthWithListStatistics(list)).toBe(44.6);
    expect(list.width).toBe(30);
    expect(listStatisticsWidth({ ...list, listStats: false })).toBe(0);
    expect(listStatisticsWidth({ ...list, type: "note" })).toBe(0);
    expect(parseProjectIndex(serializeProjectIndex([list])).notes[0]).toMatchObject({ width: 30, listStats: true });
  });
  it("uses the same measured width for selection bounds, limits and base-width conversion", () => {
    listStatisticsMeasurements[list.id] = 23;
    const width = widthWithListStatistics(list);
    expect(width).toBe(53);
    const limits = listStatisticsFrameLimits(list, 30, 75);
    expect(limits).toMatchObject({ minWidth: 53, maxWidth: 98 });
    const frame = { id: list.id, x: 40, y: 50, width, height: null, ...limits };
    // A live counter change during movement must not be stored as a base-width change.
    listStatisticsMeasurements[list.id] = 28;
    expect(geometryFromListStatisticsFrame(list, frame)).toMatchObject({ width: 30 });
    listStatisticsMeasurements[list.id] = 18;
    expect(geometryFromListStatisticsFrame(list, frame)).toEqual({ x: 40, y: 50, width: 30, height: null });
  });
  it("extends the panel to the Add footer while retaining the exact origin of each row cell", () => {
    const panel = listExtensionGeometry(300, 15, 48, 17, 180, 1);
    expect(panel.left + 15).toBe(300);
    expect(panel.cellLeft + 17).toBe(300);
    expect(panel.top + 48 + panel.height).toBe(180);
  });
});

describe("List Statistics total", () => {
  it("sums each available metric and ignores missing/zone rows and drag slots", () => {
    const rows: Array<ListRowStatistics | null> = [
      { kind: "note", name: "Note", words: 13, characters: 138, lines: 1 },
      { kind: "text", text: "hello", words: 1, characters: 5 },
      { kind: "beacon", name: "Beacon", connections: 2 }, { kind: "empty" }, null,
    ];
    const total = totalListStatistics(rows);
    expect(total).toEqual({ words: 14, characters: 143, lines: 1, connections: 2 });
    expect(formatListStatisticsTotal(total)).toBe("Σ words - 14 · characters - 143 · lines - 1 · connections - 2");
    expect(totalListStatistics([...rows].reverse())).toEqual(total);
    expect(totalListStatistics(rows.slice(1))).toEqual({ words: 1, characters: 5, connections: 2 });
  });
  it("shows present zero-valued metrics but does not invent lines or connections for text rows", () => {
    expect(formatListStatisticsTotal(totalListStatistics([{ kind: "text", text: "", words: 0, characters: 0 }]))).toBe("Σ words - 0 · characters - 0");
    expect(formatListStatisticsTotal(totalListStatistics([{ kind: "empty" }, null]))).toBe("Σ —");
  });
});

class Card {
  style = { zIndex: "" };
  attributes = new Map<string, string>();
  constructor(readonly world: Card | null = null) {}
  closest(): Card | null { return this.world; }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
}
describe("moving card stacking", () => {
  it("raises the entire card and its transformed world above other contents, restoring both after commit/cancel", () => {
    const world = new Card(), first = new Card(world), second = new Card(world), stationary = new Card(world);
    world.style.zIndex = "4"; first.style.zIndex = "7";
    const restore = raiseMovingCards([first, second] as unknown as HTMLElement[]);
    expect(world.style.zIndex).toBe("1000");
    expect(first.style.zIndex).toBe("1000"); expect(second.style.zIndex).toBe("1000");
    expect(first.getAttribute("data-node-moving")).toBe("true");
    expect(stationary.style.zIndex).toBe("");
    restore(); restore();
    expect(world.style.zIndex).toBe("4"); expect(first.style.zIndex).toBe("7"); expect(second.style.zIndex).toBe("");
    expect(first.getAttribute("data-node-moving")).toBeNull();
  });
  it("raises cards from both note and beacon worlds and restores any existing moving attribute", () => {
    const notes = new Card(), beacons = new Card(), note = new Card(notes), beacon = new Card(beacons);
    beacon.setAttribute("data-node-moving", "previous");
    const restore = raiseMovingCards([note, beacon] as unknown as HTMLElement[]);
    expect(notes.style.zIndex).toBe("1000"); expect(beacons.style.zIndex).toBe("1000");
    restore();
    expect(beacon.getAttribute("data-node-moving")).toBe("previous");
    expect(notes.style.zIndex).toBe(""); expect(beacons.style.zIndex).toBe("");
  });
});
