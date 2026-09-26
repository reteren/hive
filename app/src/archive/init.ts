import { registerCommand } from "../commands/registry.svelte";
import { board } from "../model/board.svelte";
import { registerNodeBody } from "../notes/nodeBodies";
import { registerNoteMenuItem } from "../notes/noteMenu";
import ArchiveNodeBody from "./ArchiveNodeBody.svelte";
import { archiveFromMenu, archiveSelected } from "./actions.svelte";
import { canArchiveNote } from "./logic";

registerNodeBody("archive", ArchiveNodeBody);

registerNoteMenuItem({
  id: "archive.note",
  label: () => "Archive",
  order: 85,
  visible: (noteId) => canArchiveNote(board.notes[noteId]),
  run: archiveFromMenu,
});

registerCommand({
  id: "archive.selected",
  label: "Archive selected",
  keys: [],
  run: () => { archiveSelected(); },
});
