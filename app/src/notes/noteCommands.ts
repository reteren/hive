import { registerCommand } from "../commands/registry.svelte";
import { execute } from "../history/history.svelte";
import { addNote, board, removeNote } from "../model/board.svelte";
import { DEFAULT_NOTE_WIDTH, newId, type Note } from "../model/note";
import { camera } from "../board/camera.svelte";
import { editing } from "./editing.svelte";
import { MIN_NOTE_HEIGHT } from "./layout.svelte";
import { creationMenu } from "./creation.svelte";
import { uniqueName } from "./naming";

export function toggleCreationMenu(): void {
  if (creationMenu.open) {
    creationMenu.open = false;
    creationMenu.pinned = false;
  } else {
    creationMenu.open = true;
  }
}

export function createNote(): string {
  const id = newId();
  const note: Note = {
    id,
    type: "note",
    name: uniqueName("Note", Object.values(board.notes).map((existing) => existing.name)),
    text: "",
    x: camera.x - DEFAULT_NOTE_WIDTH / 2,
    y: camera.y - MIN_NOTE_HEIGHT / 2,
    width: DEFAULT_NOTE_WIDTH,
    height: null,
  };
  const index = board.order.length;

  execute({
    label: "Create note",
    target: note.name,
    do: () => {
      addNote(note, index);
      editing.noteId = id;
    },
    undo: () => {
      removeNote(id);
      if (editing.noteId === id) editing.noteId = null;
    },
  });

  return id;
}

registerCommand({
  id: "notes.createMenu",
  label: "New note",
  keys: ["KeyQ"],
  run: toggleCreationMenu,
  isActive: () => creationMenu.open,
});
