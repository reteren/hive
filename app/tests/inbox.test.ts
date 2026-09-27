import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { history, clear as clearHistory, undo } from "../src/history/history.svelte";
import { addLink, links, replaceLinks } from "../src/model/links.svelte";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import { grid } from "../src/board/grid.svelte";
import { parseProjectIndex, serializeProjectIndex } from "../src/project/index";
import { selection } from "../src/selection/selection.svelte";
import { resolveInboxInteraction, resolveInboxTwin, submitQuickInput } from "../src/inbox/inbox.svelte";
import { inboxEntryBaseName } from "../src/inbox/inboxLogic";

function note(id: string, type: Note["type"], x: number, overrides: Partial<Note> = {}): Note {
  return {
    id,
    type,
    name: overrides.name ?? id,
    text: overrides.text ?? "",
    x,
    y: 0,
    width: type === "inbox" ? 30 : 30,
    height: null,
    ...overrides,
  };
}

function resetStores(): void {
  replaceBoard([]);
  replaceLinks([]);
  clearHistory();
  grid.snap = false;
  grid.step = 10;
}

beforeEach(resetStores);
afterEach(resetStores);

describe("Inbox quick input", () => {
  it("reports no Inbox without changing the board or consuming the text", () => {
    const existing = note("existing", "note", 0);
    replaceBoard([existing]);

    expect(submitQuickInput("keep this text")).toEqual({ ok: false, error: "no-inbox" });
    expect(board.notes.existing).toEqual(existing);
    expect(history.cursor).toBe(0);
  });

  it("creates one full-text entry with a unique first-line name and collision-free placement", () => {
    const inbox = note("inbox", "inbox", 0, { width: 30 });
    const blocker = note("blocker", "note", 32, { width: 30, height: 20 });
    const occupied = note("occupied", "note", 100, { name: "A short idea" });
    replaceBoard([inbox, blocker, occupied]);
    const text = " A short idea \nThe complete body stays here.\nAnd here.";

    const result = submitQuickInput(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entry = board.notes[result.noteIds[0]];
    expect(entry).toMatchObject({
      type: "note",
      name: "A short idea 2",
      text,
      width: 30,
      height: null,
    });
    expect(entry.x).toBeGreaterThanOrEqual(blocker.x + blocker.width + 2);
    expect(entry.y).toBe(inbox.y);
    const createdLink = Object.values(links.byId).find((link) => link.to === entry.id);
    expect(createdLink).toMatchObject({ from: inbox.id, to: entry.id, kind: "strong", shape: "base" });
    expect(history.cursor).toBe(1);
  });

  it("places shared twins for multiple Inboxes and resolves the group in one Undo step", () => {
    const inboxA = note("inbox-a", "inbox", 0);
    const inboxB = note("inbox-b", "inbox", 200);
    const unrelated = note("unrelated", "note", 400);
    replaceBoard([inboxA, inboxB, unrelated]);

    const result = submitQuickInput("A shared idea\nFull text for each twin.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const twins = result.noteIds.map((id) => board.notes[id]);
    expect(twins).toHaveLength(2);
    expect(twins[0].inboxGroup).toBeTruthy();
    expect(twins[1].inboxGroup).toBe(twins[0].inboxGroup);
    const groupId = twins[0].inboxGroup;
    expect(twins.map((twin) => twin.text)).toEqual([
      "A shared idea\nFull text for each twin.",
      "A shared idea\nFull text for each twin.",
    ]);
    expect(Object.values(links.byId).filter((link) => result.noteIds.includes(link.to))).toHaveLength(2);
    expect(history.cursor).toBe(1);

    resolveInboxInteraction([twins[0].id, twins[1].id], "marquee");
    expect(result.noteIds.every((id) => Boolean(board.notes[id]))).toBe(true);
    expect(history.cursor).toBe(1);

    selection.ids = [twins[0].id, twins[1].id];
    selection.primaryId = twins[1].id;
    resolveInboxInteraction([twins[1].id], "move");
    expect(board.notes[twins[1].id]?.inboxGroup).toBeUndefined();
    expect(board.notes[twins[0].id]).toBeUndefined();
    expect(selection.ids).toEqual([twins[1].id]);
    expect(Object.values(links.byId).some((link) => link.to === twins[0].id)).toBe(false);
    expect(history.cursor).toBe(2);

    undo();
    expect(board.notes[twins[0].id]?.inboxGroup).toBe(groupId);
    expect(board.notes[twins[1].id]?.inboxGroup).toBe(groupId);
    expect(selection.ids).toEqual([twins[0].id, twins[1].id]);
    expect(selection.primaryId).toBe(twins[1].id);
    expect(Object.values(links.byId).filter((link) => result.noteIds.includes(link.to))).toHaveLength(2);

    undo();
    expect(result.noteIds.every((id) => !board.notes[id])).toBe(true);
    expect(Object.values(links.byId).some((link) => result.noteIds.includes(link.to))).toBe(false);
  });

  it("restores links belonging to removed twins when the resolution is undone", () => {
    const inboxA = note("inbox-a", "inbox", 0);
    const inboxB = note("inbox-b", "inbox", 200);
    const other = note("other", "note", 400);
    replaceBoard([inboxA, inboxB, other]);
    const result = submitQuickInput("Linked idea");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const removedId = result.noteIds[1];
    const extraLink: Link = { id: "extra-link", from: other.id, to: removedId, kind: "weak", shape: "base" };
    addLink(extraLink);
    resolveInboxTwin(result.noteIds[0]);
    expect(links.byId[extraLink.id]).toBeUndefined();

    undo();
    expect(links.byId[extraLink.id]).toEqual(extraLink);
    expect(board.notes[removedId]?.inboxGroup).toBe(board.notes[result.noteIds[0]]?.inboxGroup);
  });

  it("persists twin group IDs and builds a 40-codepoint title from the first line", () => {
    const twin = note("twin", "note", 0, { inboxGroup: "group-1" });
    const parsed = parseProjectIndex(serializeProjectIndex([twin]));

    expect(parsed.notes[0]?.inboxGroup).toBe("group-1");
    expect(inboxEntryBaseName(`${"a".repeat(50)}\nbody`)).toBe("a".repeat(40));
    expect(inboxEntryBaseName("\nbody")).toBe("Inbox entry");
  });
});
