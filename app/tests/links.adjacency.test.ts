import { afterEach, describe, expect, it } from "vitest";
import { addLink, linksOf, linksRevision, onLinksMutation, replaceLinks, removeLink, updateLink } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";

function link(id: string, from: string, to: string): Link {
  return { id, from, to, kind: "strong", shape: "base" };
}

afterEach(() => replaceLinks([]));

describe("link endpoint adjacency", () => {
  it("returns incident links in board insertion order without duplicating a self endpoint", () => {
    const first = link("first", "a", "b");
    const second = link("second", "c", "a");
    const third = link("third", "a", "a");
    replaceLinks([first, second, third]);

    expect(linksOf("a").map(({ id }) => id)).toEqual(["first", "second", "third"]);
    expect(linksOf("b").map(({ id }) => id)).toEqual(["first"]);
    expect(linksOf("missing")).toEqual([]);
  });

  it("keeps adjacency ordered through endpoint updates, removal, restore, and replacement", () => {
    const first = link("first", "a", "x");
    const second = link("second", "a", "y");
    addLink(first);
    addLink(second);

    updateLink("first", { from: "b", to: "x" });
    expect(linksOf("a").map(({ id }) => id)).toEqual(["second"]);
    expect(linksOf("b").map(({ id }) => id)).toEqual(["first"]);

    const removed = removeLink("second");
    expect(removed).toBe(second);
    expect(linksOf("a")).toEqual([]);
    addLink(second);
    expect(linksOf("a").map(({ id }) => id)).toEqual(["second"]);

    replaceLinks([link("replacement", "a", "z"), link("last", "a", "w")]);
    expect(linksOf("a").map(({ id }) => id)).toEqual(["replacement", "last"]);
    expect(linksOf("b")).toEqual([]);
  });

  it("notifies per-link mutations and full replacements", () => {
    const changes: Array<{ ids: readonly string[] | null; topology: boolean }> = [];
    const revision = linksRevision();
    const unsubscribe = onLinksMutation((ids, topology) => changes.push({ ids, topology }));
    addLink(link("one", "a", "b"));
    updateLink("one", { shape: "wave" });
    removeLink("one");
    replaceLinks([link("two", "a", "c")]);
    unsubscribe();

    expect(changes).toEqual([
      { ids: ["one"], topology: true },
      { ids: ["one"], topology: false },
      { ids: ["one"], topology: true },
      { ids: null, topology: true },
    ]);
    expect(linksRevision()).toBe(revision + changes.length);
  });
});
