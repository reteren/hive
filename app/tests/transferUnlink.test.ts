import { beforeEach, describe, expect, it } from "vitest";
import { deleteSelection } from "../src/clipboard/commands";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { cutLinks, unlink } from "../src/links/operations";
import { clearSelectedLink } from "../src/links/selection.svelte";
import { addLink, links, replaceLinks, updateLink } from "../src/model/links.svelte";
import { addNote, board, replaceBoard } from "../src/model/board.svelte";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import { clearSelection, selectOnly } from "../src/selection/selection.svelte";
import { replaceTransferText } from "../src/transfer/sync.svelte";
import { selectActiveTransfers, stabilizeActiveTransfers } from "../src/transfer/logic";

interface Fixture {
  aLink: Link;
  cLink: Link;
  aId: string;
  cId: string;
  taskId: string;
}

let fixtureNumber = 0;
const selectedSources = new Map<string, string>();
let currentFixture: Fixture;

function note(id: string, text: string, task = false): Note {
  return {
    id,
    type: "note",
    name: id.toUpperCase(),
    text,
    x: 0,
    y: 0,
    width: 30,
    height: null,
    ...(task ? { task: { done: false, doneAt: null } } : {}),
  };
}

function createBoard(): void {
  fixtureNumber += 1;
  const suffix = String(fixtureNumber);
  const aId = `a-${suffix}`;
  const cId = `c-${suffix}`;
  const taskId = `task-${suffix}`;
  const aLink: Link = {
    id: `link-a-task-${suffix}`,
    from: aId,
    to: taskId,
    kind: "strong",
    shape: "base",
    transferDeclined: false,
    transferOriginalText: "draft before A",
  };
  const cLink: Link = {
    id: `link-c-task-${suffix}`,
    from: cId,
    to: taskId,
    kind: "strong",
    shape: "base",
  };
  currentFixture = { aLink, cLink, aId, cId, taskId };

  clear();
  clearSelection();
  clearSelectedLink();
  replaceBoard([note(aId, "text from A"), note(cId, "text from C"), note(taskId, "text from A", true)]);
  replaceLinks([{ ...aLink }]);
}

function stabilize(): Map<string, Link> {
  const linkList = Object.values(links.byId);
  const initial = selectActiveTransfers(linkList, board.notes);
  const stable = stabilizeActiveTransfers(initial, linkList, board.notes, selectedSources);
  for (const inactive of stable.linksToDeactivate) updateLink(inactive.id, { transferDeclined: true });
  const selected = stable.linksToDeactivate.length > 0
    ? selectActiveTransfers(Object.values(links.byId), board.notes)
    : { ...initial, activeByTarget: stable.activeByTarget };
  for (const [targetId, link] of selected.activeByTarget) selectedSources.set(targetId, link.id);
  return selected.activeByTarget;
}

function acceptC(): void {
  const { cLink, taskId } = currentFixture;
  addLink({ ...cLink });
  replaceTransferText(cLink.id);
  clear();
  selectedSources.set(taskId, cLink.id);

  expect(board.notes[taskId]?.text).toBe("text from C");
  expect(links.byId[cLink.id]?.transferOriginalText).toBe("draft before A");
  expect(links.byId[currentFixture.aLink.id]?.transferDeclined).toBe(true);
  expect(stabilize().get(taskId)?.id).toBe(cLink.id);
}

describe("Text → Task source removal", () => {
  beforeEach(createBoard);

  it("restores the original task text on unlink; one Undo and Redo carry both changes", () => {
    acceptC();
    const { aLink, cLink, taskId } = currentFixture;

    expect(unlink(cLink.id)).toBe(true);
    expect(stabilize().has(taskId)).toBe(false);
    expect(board.notes[taskId]?.text).toBe("draft before A");
    expect(Object.keys(links.byId)).toEqual([aLink.id]);
    expect(history.entries.map(({ label }) => label)).toEqual(["Unlink"]);

    undo();
    expect(links.byId[cLink.id]).toBeDefined();
    expect(stabilize().get(taskId)?.id).toBe(cLink.id);
    expect(board.notes[taskId]?.text).toBe("text from C");
    expect(history.entries.map(({ label }) => label)).toEqual(["Unlink"]);
    expect(history.cursor).toBe(0);
    redo();
    expect(links.byId[cLink.id]).toBeUndefined();
    expect(board.notes[taskId]?.text).toBe("draft before A");
  });

  it("restores the original on cut without reviving an older source", () => {
    acceptC();
    const { cLink, taskId } = currentFixture;

    expect(cutLinks([cLink.id])).toBe(true);
    expect(stabilize().has(taskId)).toBe(false);
    expect(board.notes[taskId]?.text).toBe("draft before A");
    expect(history.entries.map(({ label }) => label)).toEqual(["Cut lines"]);

    undo();
    expect(links.byId[cLink.id]).toBeDefined();
    expect(stabilize().get(taskId)?.id).toBe(cLink.id);
    expect(board.notes[taskId]?.text).toBe("text from C");
    expect(history.entries.map(({ label }) => label)).toEqual(["Cut lines"]);
    expect(history.cursor).toBe(0);
    redo();
    expect(board.notes[taskId]?.text).toBe("draft before A");
  });

  it("restores original text when deleting the source and replays both changes on Undo/Redo", () => {
    acceptC();
    const { cId, cLink, taskId } = currentFixture;
    selectOnly(cId);

    deleteSelection();
    expect(board.notes[cId]).toBeUndefined();
    expect(links.byId[cLink.id]).toBeUndefined();
    expect(stabilize().has(taskId)).toBe(false);
    expect(board.notes[taskId]?.text).toBe("draft before A");
    expect(history.entries.map(({ label }) => label)).toEqual(["Delete"]);

    undo();
    expect(board.notes[cId]).toBeDefined();
    expect(links.byId[cLink.id]).toBeDefined();
    expect(stabilize().get(taskId)?.id).toBe(cLink.id);
    expect(board.notes[taskId]?.text).toBe("text from C");
    expect(history.entries.map(({ label }) => label)).toEqual(["Delete"]);
    expect(history.cursor).toBe(0);
    redo();
    expect(board.notes[cId]).toBeUndefined();
    expect(board.notes[taskId]?.text).toBe("draft before A");
  });

  it("returns an initially empty task to empty when its accepted link breaks", () => {
    const { aLink, taskId } = currentFixture;
    updateLink(aLink.id, { transferOriginalText: "" });
    expect(unlink(aLink.id)).toBe(true);
    expect(board.notes[taskId]?.text).toBe("");
    undo();
    expect(board.notes[taskId]?.text).toBe("text from A");
  });

  it("carries the first original through a third accepted source", () => {
    acceptC();
    const { taskId, cLink } = currentFixture;
    const dId = `d-${fixtureNumber}`;
    const dLink: Link = { id: `link-d-task-${fixtureNumber}`, from: dId, to: taskId, kind: "strong", shape: "base" };
    addNote(note(dId, "text from D"));
    addLink(dLink);
    replaceTransferText(dLink.id);

    expect(board.notes[taskId]?.text).toBe("text from D");
    expect(links.byId[cLink.id]?.transferDeclined).toBe(true);
    expect(links.byId[dLink.id]?.transferOriginalText).toBe("draft before A");
    clear();
    expect(unlink(dLink.id)).toBe(true);
    expect(board.notes[taskId]?.text).toBe("draft before A");
    undo();
    expect(board.notes[taskId]?.text).toBe("text from D");
  });
});
