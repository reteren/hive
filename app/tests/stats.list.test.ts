import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard, updateNote } from "../src/model/board.svelte";
import { clear as clearHistory, history, redo, undo } from "../src/history/history.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import type { ListItem } from "../src/model/nodeData";
import type { Note } from "../src/model/note";
import { tryInsertModuleOnDrop } from "../src/modules/moduleActions.svelte";
import { listViewForStats } from "../src/stats/linkedList.svelte";
import { extractStatisticsFromList } from "../src/stats/listStatsActions.svelte";
import { formatLinkedListRow, formatListRowExtension, statisticsForListRow } from "../src/stats/listStatistics";

function note(id: string, type: Note["type"], overrides: Partial<Note> = {}): Note {
  return {
    id,
    type,
    name: overrides.name ?? id,
    text: "",
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    width: overrides.width ?? 30,
    height: overrides.height ?? 20,
    ...overrides,
  };
}

function item(id: string, targetId: string | null, label = ""): ListItem {
  return { id, targetId, label };
}

function link(id: string, from: string, to: string, kind: Link["kind"] = "strong"): Link {
  return { id, from, to, kind, shape: "base" };
}

function reset(): void {
  replaceBoard([]);
  replaceLinks([]);
  clearHistory();
}

beforeEach(reset);
afterEach(reset);

describe("List row statistics", () => {
  it("counts text rows and note rows with their required fields and labels", () => {
    const text = item("text-row", null, "hello 😀 world");
    const noteRow = item("note-row", "note", "old label");
    const notes = { note: note("note", "note", { name: "Meeting", text: "one two\r\nthree" }) };

    const textStats = statisticsForListRow("list", text, notes, {});
    expect(textStats).toMatchObject({ kind: "text", words: 2, characters: 13, text: "hello 😀 world" });
    expect(formatLinkedListRow(textStats)).toBe("hello 😀 world · words - 2 · characters - 13");
    expect(formatListRowExtension(textStats)).toBe("words - 2 · characters - 13");

    const noteStats = statisticsForListRow("list", noteRow, notes, {});
    expect(noteStats).toMatchObject({ kind: "note", name: "Meeting", words: 3, lines: 2 });
    expect(formatLinkedListRow(noteStats)).toBe("Meeting · words - 3 · characters - 14 · lines - 2");
    expect(formatListRowExtension(noteStats)).toBe("words - 3 · characters - 14 · lines - 2");
  });

  it("counts all beacon connections, including ME and weak links", () => {
    const beacon = note("beacon", "beacon", { name: "Planning" });
    const notes = { beacon };
    const edges = {
      first: link("first", "source", "beacon"),
      second: link("second", "beacon", "target", "weak"),
      third: link("third", "me", "beacon"),
      other: link("other", "unrelated", "target"),
    };
    const stats = statisticsForListRow("list", item("beacon-row", "beacon"), notes, edges);
    expect(stats).toEqual({ kind: "beacon", name: "Planning", connections: 3 });
    expect(formatLinkedListRow(stats)).toBe("Planning · connections - 3");
    expect(formatListRowExtension(stats)).toBe("connections - 3");
    expect(statisticsForListRow("list", item("me-row", "me"), notes, edges))
      .toEqual({ kind: "beacon", name: "ME", connections: 1 });
  });

  it("shows zones, missing targets, and unsupported note kinds as a dash", () => {
    const notes = { calculator: note("calculator", "calculator", { text: "ignored" }) };
    for (const targetId of ["zone-1", "deleted-note", "calculator"]) {
      const stats = statisticsForListRow("list", item(`row-${targetId}`, targetId), notes, {});
      expect(stats).toEqual({ kind: "empty" });
      expect(formatLinkedListRow(stats)).toBe("—");
      expect(formatListRowExtension(stats)).toBe("—");
    }
  });

  it("memoizes unchanged results and refreshes when text or links change", () => {
    const row = item("memo-row", "note");
    const notes = { note: note("note", "note", { text: "one" }) };
    replaceBoard([notes.note]);
    const first = statisticsForListRow("memo-list", row, board.notes, {});
    expect(statisticsForListRow("memo-list", row, board.notes, {})).toBe(first);

    updateNote("note", { text: "two words" });
    const changed = statisticsForListRow("memo-list", row, board.notes, {});
    expect(changed).not.toBe(first);
    expect(changed).toMatchObject({ words: 2 });

    const beacon = note("memo-beacon", "beacon");
    replaceBoard([beacon]);
    const beaconRow = item("memo-beacon-row", "memo-beacon");
    const zero = statisticsForListRow("memo-list", beaconRow, board.notes, links.byId);
    replaceLinks([link("new-edge", "memo-beacon", "elsewhere")]);
    const one = statisticsForListRow("memo-list", beaconRow, board.notes, links.byId);
    expect(one).not.toBe(zero);
    expect(one).toMatchObject({ connections: 1 });
  });
});

describe("Statistics linked to a List", () => {
  it("uses the newest strong outgoing List link and keeps rows in List order", () => {
    const stats = note("stats", "stats");
    const list = note("list", "list", {
      name: "Reading list",
      listItems: [item("second", null, "plain row"), item("first", "target")],
    });
    const target = note("target", "con", { name: "Question", text: "why now" });
    const anotherList = note("other-list", "list", { name: "Other" });
    replaceBoard([stats, list, target, anotherList]);
    replaceLinks([
      link("weak", "stats", "other-list", "weak"),
      link("first", "stats", "other-list"),
      link("last", "stats", "list"),
    ]);

    expect(listViewForStats("stats")).toEqual({
      list,
      rows: [
        { item: list.listItems![0], text: "plain row · words - 2 · characters - 9" },
        { item: list.listItems![1], text: "Question · words - 2 · characters - 7 · lines - 1" },
      ],
    });
  });
});

describe("List Statistics insert and extract history", () => {
  it("inserts a Statistics node into the List and restores its link and order on Undo", () => {
    const list = note("list", "list", { x: 0, y: 0, listItems: [item("row", "target")] });
    const stats = note("stats", "stats", { x: 70, y: 0, name: "Row counts" });
    const attached = link("stats-list", "stats", "list");
    replaceBoard([list, stats]);
    replaceLinks([attached]);
    const order = [...board.order];

    expect(tryInsertModuleOnDrop("stats", { x: 5, y: 5 })).toBe(true);
    expect(board.notes.list?.listStats).toBe(true);
    expect(board.notes.stats).toBeUndefined();
    expect(links.byId[attached.id]).toBeUndefined();
    expect(history.cursor).toBe(1);

    undo();
    expect(board.order).toEqual(order);
    expect(board.notes.list?.listStats).toBeUndefined();
    expect(board.notes.stats).toMatchObject({ id: "stats", name: "Row counts" });
    expect(links.byId[attached.id]).toEqual(attached);

    redo();
    expect(board.notes.list?.listStats).toBe(true);
    expect(board.notes.stats).toBeUndefined();
  });

  it("leaves the Statistics node on the ordinary Move path when dropped on a non-List", () => {
    replaceBoard([
      note("note", "note", { x: 0, y: 0 }),
      note("stats", "stats", { x: 70, y: 0 }),
    ]);

    expect(tryInsertModuleOnDrop("stats", { x: 5, y: 5 })).toBe(false);
    expect(board.notes.stats).toBeDefined();
    expect(history.cursor).toBe(0);
  });

  it("pulls the List extension out as a linked Statistics node with one Undo step", () => {
    const list = note("list", "list", { x: 0, y: 0, name: "Tasks", listStats: true });
    replaceBoard([list]);

    expect(extractStatisticsFromList("list", { x: 70, y: 20 })).toBe(true);
    expect(board.notes.list?.listStats).toBe(false);
    expect(history.cursor).toBe(1);
    const stats = Object.values(board.notes).find((candidate) => candidate.type === "stats");
    expect(stats).toMatchObject({ type: "stats", width: 30, height: null, createdAt: expect.any(Number) });
    const statsLink = Object.values(links.byId)[0];
    expect(statsLink).toMatchObject({ from: stats?.id, to: "list", kind: "strong" });

    undo();
    expect(board.order).toEqual(["list"]);
    expect(board.notes.list?.listStats).toBe(true);
    expect(Object.keys(links.byId)).toEqual([]);

    redo();
    expect(board.notes.list?.listStats).toBe(false);
    expect(board.notes[stats!.id]).toBeDefined();
    expect(links.byId[statsLink.id]).toEqual(statsLink);
  });
});
