import { board, updateNote } from "../model/board.svelte";
import { execute } from "../history/history.svelte";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { uniqueName } from "../notes/naming";
import { registerCommand } from "../commands/registry.svelte";
import { selection } from "../selection/selection.svelte";
import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { normalizeBeaconColor } from "./beaconPalette";

export type BeaconEditMode = "rename" | "color";

export const beaconEditor = $state({ noteId: null as string | null, mode: "rename" as BeaconEditMode });

export function openBeaconEditor(noteId: string, mode: BeaconEditMode): void {
  if (board.notes[noteId]?.type !== "beacon") return;
  beaconEditor.noteId = noteId;
  beaconEditor.mode = mode;
}

export function closeBeaconEditor(): void {
  beaconEditor.noteId = null;
}

export function renameBeacon(noteId: string, draft: string): boolean {
  const note = board.notes[noteId];
  if (note?.type !== "beacon") return false;
  const nextName = uniqueName(draft, Object.values(board.notes).filter((other) => other.id !== noteId).map((other) => other.name));
  if (nextName === note.name) return false;
  const previousName = note.name;
  execute({
    label: "Rename beacon",
    target: nextName,
    do: () => updateNote(noteId, { name: nextName }),
    undo: () => updateNote(noteId, { name: previousName }),
  });
  return true;
}

export function recolorBeacon(noteId: string, draft: string): boolean {
  const note = board.notes[noteId];
  const nextColor = normalizeBeaconColor(draft);
  if (note?.type !== "beacon" || !nextColor || nextColor === note.color) return false;
  const previousColor = note.color;
  execute({
    label: "Beacon colour",
    target: note.name,
    do: () => updateNote(noteId, { color: nextColor }),
    undo: () => updateNote(noteId, { color: previousColor }),
  });
  return true;
}

function editSelectedBeacon(mode: BeaconEditMode): void {
  const id = selection.primaryId;
  if (!id || board.notes[id]?.type !== "beacon") {
    showLinkStatus("Select a beacon first.");
    return;
  }
  openBeaconEditor(id, mode);
}

registerNoteMenuItem({
  id: "beacons.rename",
  label: () => "Rename beacon",
  order: 20,
  visible: (noteId) => board.notes[noteId]?.type === "beacon",
  run: (noteId) => openBeaconEditor(noteId, "rename"),
});

registerNoteMenuItem({
  id: "beacons.color",
  label: () => "Change color",
  order: 21,
  visible: (noteId) => board.notes[noteId]?.type === "beacon",
  run: (noteId) => openBeaconEditor(noteId, "color"),
});

registerCommand({
  id: "beacons.rename",
  label: "Rename beacon",
  keys: [],
  run: () => editSelectedBeacon("rename"),
});

registerCommand({
  id: "beacons.color",
  label: "Change beacon color",
  keys: [],
  run: () => editSelectedBeacon("color"),
});
