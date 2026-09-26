import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import type { Link } from "../src/model/link";
import type { TierRow } from "../src/model/nodeData";
import { board, replaceBoard, updateNote } from "../src/model/board.svelte";
import { addLink, removeLink, replaceLinks } from "../src/model/links.svelte";
import { linkRefusalReason } from "../src/links/rules";
import { scopeForNote } from "../src/scope/scope.svelte";
import { tierlistViewForStats } from "../src/stats/linkedTierlist.svelte";
import { summarizeTextStatistics, summarizeTierlist } from "../src/stats/statistics";

function textNote(id: string, type: Note["type"], text: string, task = false): Note {
  return {
    id,
    type,
    name: id,
    text,
    x: 0,
    y: 0,
    width: 30,
    height: null,
    ...(task ? { task: { done: false, doneAt: null } } : {}),
  };
}

describe("text statistics", () => {
  it("counts words, Unicode code points, and lines from text notes and task text", () => {
    const notes = {
      ordinary: textNote("ordinary", "note", "one two\n😀"),
      plus: textNote("plus", "pro", "x", true),
      minus: textNote("minus", "con", "can't re-enter"),
    };
    expect(summarizeTextStatistics(Object.keys(notes), notes)).toEqual({
      words: 5,
      characters: 24,
      lines: 4,
      noteCount: 3,
    });
  });

  it("excludes calculators, tierlists, beacons and modules, and deduplicates IDs", () => {
    const notes = {
      text: textNote("text", "note", "hello"),
      calculator: textNote("calculator", "calculator", "hidden words"),
      tierlist: textNote("tierlist", "tierlist", "hidden too"),
      beacon: textNote("beacon", "beacon", "hidden"),
      module: textNote("module", "importance", "hidden"),
    };
    expect(summarizeTextStatistics(["text", "text", "calculator", "tierlist", "beacon", "module"], notes))
      .toEqual({ words: 1, characters: 5, lines: 1, noteCount: 1 });
  });

  it("treats empty note text as zero lines", () => {
    expect(summarizeTextStatistics(["empty"], { empty: textNote("empty", "note", "") }))
      .toEqual({ words: 0, characters: 0, lines: 0, noteCount: 1 });
  });
});

function strongLink(id: string, from: string, to: string, kind: Link["kind"] = "strong"): Link {
  return { id, from, to, kind, shape: "base" };
}

function tierRow(id: string, name: string, color: string, count: number): TierRow {
  return {
    id, name, color,
    cards: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, kind: "text" as const, text: `Card ${index}` })),
  };
}

describe("tierlist-linked statistics", () => {
  it("counts cards in tierlist order, including empty rows", () => {
    const rows = [tierRow("s", "S", "#ff0000", 3), tierRow("a", "A", "#ffff00", 1), tierRow("b", "B", "#00ff00", 0)];
    expect(summarizeTierlist(rows)).toEqual({
      total: 4,
      rows: [
        { id: "s", name: "S", color: "#ff0000", count: 3 },
        { id: "a", name: "A", color: "#ffff00", count: 1 },
        { id: "b", name: "B", color: "#00ff00", count: 0 },
      ],
    });
  });

  it("recounts after cards move and rows are renamed, recoloured, added, or removed", () => {
    const stats = { ...textNote("stats", "stats", ""), scope: { kind: "board" as const } };
    const tierlist = { ...textNote("tier", "tierlist", ""), tiers: [tierRow("s", "S", "#ff0000", 2), tierRow("a", "A", "#ffff00", 0)] };
    replaceBoard([stats, tierlist]);
    replaceLinks([strongLink("stats-tier", "stats", "tier")]);
    expect(tierlistViewForStats("stats")?.summary).toMatchObject({ total: 2, rows: [{ count: 2 }, { count: 0 }] });

    const movedCard = tierlist.tiers[0].cards[0];
    updateNote("tier", { tiers: [
      { ...tierlist.tiers[1], name: "Top", color: "#123456", cards: [movedCard] },
      { ...tierlist.tiers[0], cards: [tierlist.tiers[0].cards[1]] },
      tierRow("new", "New", "#abcdef", 0),
    ] });
    expect(tierlistViewForStats("stats")?.summary).toEqual({
      total: 2,
      rows: [
        { id: "a", name: "Top", color: "#123456", count: 1 },
        { id: "s", name: "S", color: "#ff0000", count: 1 },
        { id: "new", name: "New", color: "#abcdef", count: 0 },
      ],
    });

    updateNote("tier", { tiers: [tierRow("new", "New", "#abcdef", 0)] });
    expect(tierlistViewForStats("stats")?.summary).toEqual({
      total: 0, rows: [{ id: "new", name: "New", color: "#abcdef", count: 0 }],
    });
    replaceBoard([]);
    replaceLinks([]);
  });

  it("locks on the newest strong tierlist link, outranks beacons, then restores the stored scope", () => {
    const stats = { ...textNote("stats", "stats", ""), scope: { kind: "board" as const } };
    replaceBoard([stats, textNote("first", "tierlist", ""), textNote("second", "tierlist", ""), textNote("beacon", "beacon", "")]);
    replaceLinks([strongLink("stats-beacon", "stats", "beacon")]);
    expect(tierlistViewForStats("stats")).toBeNull();
    expect(scopeForNote(board.notes.stats)).toEqual({ kind: "beacon", id: "beacon" });

    addLink(strongLink("stats-first", "stats", "first"));
    addLink(strongLink("stats-second", "stats", "second"));
    expect(tierlistViewForStats("stats")?.tierlist.id).toBe("second");
    expect(board.notes.stats.scope).toEqual({ kind: "board" });
    removeLink("stats-second");
    expect(tierlistViewForStats("stats")?.tierlist.id).toBe("first");
    removeLink("stats-first");
    expect(tierlistViewForStats("stats")).toBeNull();
    expect(scopeForNote(board.notes.stats)).toEqual({ kind: "beacon", id: "beacon" });
    removeLink("stats-beacon");
    expect(scopeForNote(board.notes.stats)).toEqual({ kind: "board" });
    replaceBoard([]);
    replaceLinks([]);
  });

  it("allows strong Statistics links, refuses strong Progress links, and retains unrelated link rules", () => {
    const notes = {
      stats: textNote("stats", "stats", ""),
      progress: textNote("progress", "progress", ""),
      tier: textNote("tier", "tierlist", ""),
      plain: textNote("plain", "note", ""),
    };
    expect(linkRefusalReason("stats", "tier", "strong", [], notes)).toBeNull();
    expect(linkRefusalReason("progress", "tier", "strong", [], notes)).toMatch(/Progress/);
    expect(linkRefusalReason("progress", "tier", "weak", [], notes)).toBeNull();
    expect(linkRefusalReason("plain", "tier", "strong", [], notes)).toBeNull();
  });
});
