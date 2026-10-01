import { openUrl } from "@tauri-apps/plugin-opener";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { board } from "../model/board.svelte";
import { showLinkStatus } from "../links-in-text/contextMenu.svelte";

registerNoteMenuItem({
  id: "youtube.open",
  label: () => "Open on YouTube",
  visible: (noteId) => board.notes[noteId]?.type === "youtube" && Boolean(board.notes[noteId]?.youtube),
  run: (noteId) => {
    const note = board.notes[noteId];
    const url = note?.type === "youtube" ? note.youtube?.url : undefined;
    if (!url) return;
    void openUrl(url).catch(() => showLinkStatus("Could not open this YouTube link."));
  },
  order: 80,
});
