import { execute } from "../history/history.svelte";
import { addLink, canLink, linksOf, removeLink } from "../model/links.svelte";
import type { Link } from "../model/link";
import { addNote, board, orderIndex, removeNote, updateNote } from "../model/board.svelte";
import { newId, type Note } from "../model/note";
import { grid } from "../board/grid.svelte";
import { measuredHeights } from "../notes/layout.svelte";
import {
  captureSelectionSnapshot,
  clearSelectionSnapshotExtensions,
  restoreSelectionSnapshot,
  type SelectionInteractionSource,
} from "../selection/selection.svelte";
import { placeInboxEntries } from "./inboxLogic";
import { inboxAutoHeight } from "./inboxLayout";

export type QuickInputResult =
  | { ok: true; noteIds: string[] }
  | { ok: false; error: "no-inbox" };

/** Create one linked note per Inbox as a single reversible history action. */
export function submitQuickInput(text: string): QuickInputResult {
  const inboxes = board.order.flatMap((id) => {
    const note = board.notes[id];
    return note?.type === "inbox" ? [note] : [];
  });
  if (inboxes.length === 0) return { ok: false, error: "no-inbox" };

  const notes = placeInboxEntries(text, inboxes, Object.values(board.notes), {
    ...(inboxes.length > 1 ? { groupId: newId() } : {}),
    createdAt: Date.now(),
    nextId: newId,
    snap: grid.snap,
    step: grid.step,
    measuredHeights,
    inboxAutoHeights: Object.fromEntries(inboxes.map((inbox) => [inbox.id, inboxAutoHeight(inbox)])),
  });
  const createdLinks: Link[] = inboxes.map((inbox, index) => {
    const target = notes[index];
    if (!target || !canLink(inbox.id, target.id, "strong")) {
      throw new Error(`Could not link Inbox ${inbox.id} to its new entry.`);
    }
    return {
      id: newId(),
      from: inbox.id,
      to: target.id,
      kind: "strong",
      shape: "base",
    };
  });

  const firstIndex = board.order.length;
  const target = notes.length === 1 ? notes[0].name : `${notes.length} Inbox entries`;
  execute({
    label: "Quick input to Inbox",
    target,
    do: () => {
      notes.forEach((note, index) => addNote(note, firstIndex + index));
      createdLinks.forEach(addLink);
    },
    undo: () => {
      [...createdLinks].reverse().forEach((link) => removeLink(link.id));
      [...notes].reverse().forEach((note) => removeNote(note.id));
    },
  });

  return { ok: true, noteIds: notes.map((note) => note.id) };
}

/** Keep the interacted twin and remove its siblings in one Undoable operation. */
export function resolveInboxTwin(noteId: string): boolean {
  const keep = board.notes[noteId];
  const groupId = keep?.inboxGroup;
  if (!keep || !groupId) return false;

  const siblings = board.order.flatMap((id) => {
    const note = board.notes[id];
    return note?.inboxGroup === groupId && note.id !== keep.id
      ? [{ note: copyNote(note), index: orderIndex(id) }]
      : [];
  });
  const removedLinks = [...new Map(
    siblings.flatMap(({ note }) => linksOf(note.id).map((link) => [link.id, copyLink(link)] as const)),
  ).values()];
  const keepSnapshot = copyNote(keep);
  const previousSelection = captureSelectionSnapshot();
  const removedIds = new Set(siblings.map(({ note }) => note.id));
  const remainingSelection = clearSelectionSnapshotExtensions(previousSelection);
  remainingSelection.ids = previousSelection.ids.filter((id) => !removedIds.has(id));
  remainingSelection.primaryId = remainingSelection.ids.includes(previousSelection.primaryId ?? "")
    ? previousSelection.primaryId
    : remainingSelection.ids.includes(keep.id)
      ? keep.id
      : remainingSelection.ids.at(-1) ?? null;

  execute({
    label: "Keep Inbox entry",
    target: keep.name,
    do: () => {
      updateNote(keep.id, { inboxGroup: undefined });
      removedLinks.forEach((link) => removeLink(link.id));
      [...siblings].sort((first, second) => second.index - first.index)
        .forEach(({ note }) => removeNote(note.id));
      restoreSelectionSnapshot(remainingSelection);
    },
    undo: () => {
      [...siblings].sort((first, second) => first.index - second.index)
        .forEach(({ note, index }) => addNote(copyNote(note), index));
      updateNote(keep.id, { inboxGroup: keepSnapshot.inboxGroup });
      removedLinks.forEach((link) => addLink(copyLink(link)));
      restoreSelectionSnapshot(previousSelection);
    },
  });

  return true;
}

/** Marquee contact is deliberately ignored; click, edit, or move commits choose a twin. */
export function resolveInboxInteraction(noteIds: readonly string[], source: SelectionInteractionSource): void {
  if (source === "marquee") return;
  for (const noteId of noteIds) resolveInboxTwin(noteId);
}

function copyNote(note: Note): Note {
  return {
    ...note,
    ...(note.task !== undefined ? { task: note.task ? { ...note.task } : null } : {}),
    ...(note.taskMemory !== undefined ? { taskMemory: note.taskMemory ? { ...note.taskMemory } : null } : {}),
    ...(note.purposes ? { purposes: [...note.purposes] } : {}),
    ...(note.moods ? { moods: [...note.moods] } : {}),
  };
}

function copyLink(link: Link): Link {
  return {
    ...link,
    ...(link.fromAnchor ? { fromAnchor: { ...link.fromAnchor } } : {}),
    ...(link.toAnchor ? { toAnchor: { ...link.toAnchor } } : {}),
  };
}
