import { grid } from "../board/grid.svelte";
import type { Point } from "../board/cameraMath";
import { execute } from "../history/history.svelte";
import { addNote, board, orderIndex, removeNote, updateNote } from "../model/board.svelte";
import { addLink, linksOf, removeLink } from "../model/links.svelte";
import { newId, R5_BASE_WIDTHS, type Note } from "../model/note";
import type { Link } from "../model/link";
import { editing } from "../notes/editing.svelte";
import { creationObstacleForNote, estimatedCreationHeight, nearestFreeNoteCenter, notePositionAt } from "../notes/creationPosition";
import { measuredHeights } from "../notes/layout.svelte";
import { uniqueName } from "../notes/naming";
import { widthWithListStatistics } from "./listStatsLayout";

/** Replace a Statistics node with the List's per-row extension as one Undo step. */
export function insertStatisticsIntoList(statsId: string, listId: string): boolean {
  const stats = board.notes[statsId];
  const list = board.notes[listId];
  if (stats?.type !== "stats" || list?.type !== "list" || list.listStats === true || statsId === listId) return false;

  const statsSnapshot = copyNote(stats);
  const attachedLinks = linksOf(statsId).map(copyLink);
  const statsIndex = orderIndex(statsId);
  const priorListStats = list.listStats;
  const priorEditing = editing.noteId;

  execute({
    label: "Insert Statistics into List",
    target: list.name,
    do: () => {
      updateNote(listId, { listStats: true });
      for (const link of attachedLinks) removeLink(link.id);
      removeNote(statsId);
      if (editing.noteId === statsId) editing.noteId = null;
    },
    undo: () => {
      updateNote(listId, { listStats: priorListStats });
      addNote(copyNote(statsSnapshot), statsIndex);
      for (const link of attachedLinks) addLink(copyLink(link));
      editing.noteId = priorEditing;
    },
  });
  return true;
}

/** Pull the List extension into a linked Statistics node as one Undo step. */
export function extractStatisticsFromList(listId: string, worldPoint: Point): boolean {
  const list = board.notes[listId];
  if (list?.type !== "list" || list.listStats !== true) return false;

  const note = createStatisticsNote(worldPoint);
  const link: Link = { id: newId(), from: note.id, to: list.id, kind: "strong", shape: "base" };
  const index = board.order.length;

  execute({
    label: "Extract Statistics from List",
    target: list.name,
    do: () => {
      updateNote(listId, { listStats: false });
      addNote(copyNote(note), index);
      addLink(copyLink(link));
    },
    undo: () => {
      removeLink(link.id);
      removeNote(note.id);
      updateNote(listId, { listStats: true });
    },
  });
  return true;
}

function createStatisticsNote(worldPoint: Point): Note {
  const id = newId();
  const width = R5_BASE_WIDTHS.stats;
  const height = estimatedCreationHeight({ type: "stats", width, height: null, text: "" });
  const center = nearestFreeNoteCenter(
    worldPoint,
    width,
    height,
    Object.values(board.notes).map((note) => creationObstacleForNote({ ...note, width: widthWithListStatistics(note) }, measuredHeights[note.id])),
    grid.snap,
    grid.step,
  );
  const position = notePositionAt(center, width, height, false, grid.step);
  return {
    id,
    type: "stats",
    name: uniqueName("Statistics", Object.values(board.notes).map((note) => note.name)),
    text: "",
    x: position.x,
    y: position.y,
    width,
    height: null,
    createdAt: Date.now(),
  };
}

function copyNote(note: Note): Note {
  return {
    ...note,
    ...(note.task ? { task: { ...note.task } } : {}),
    ...(note.taskMemory ? { taskMemory: { ...note.taskMemory } } : {}),
    ...(note.scope ? { scope: { ...note.scope } } : {}),
    ...(note.purposes ? { purposes: [...note.purposes] } : {}),
    ...(note.moods ? { moods: [...note.moods] } : {}),
    ...(note.listItems ? { listItems: note.listItems.map((item) => ({ ...item })) } : {}),
    ...(note.tiers ? { tiers: note.tiers.map((tier) => ({
      ...tier,
      cards: tier.cards.map((card) => ({ ...card })),
    })) } : {}),
    ...(note.source ? { source: { ...note.source } } : {}),
    ...(note.randomPick ? { randomPick: { ...note.randomPick } } : {}),
    ...(note.customMarks ? { customMarks: note.customMarks.map((mark) => ({ ...mark })) } : {}),
  };
}

function copyLink(link: Link): Link {
  return {
    ...link,
    ...(link.fromAnchor ? { fromAnchor: { ...link.fromAnchor } } : {}),
    ...(link.toAnchor ? { toAnchor: { ...link.toAnchor } } : {}),
  };
}
