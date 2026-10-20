import { openUrl } from "@tauri-apps/plugin-opener";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { board, updateNote } from "../model/board.svelte";
import { execute } from "../history/history.svelte";
import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { t } from "../i18n/i18n.svelte";

registerNoteMenuItem({
  id: "youtube.toggleLoop",
  label: (noteId) => board.notes[noteId]?.type === "youtube" && board.notes[noteId]?.youtube?.loop ? t("Stop looping") : t("Loop video"),
  visible: (noteId) => board.notes[noteId]?.type === "youtube" && Boolean(board.notes[noteId]?.youtube),
  run: (noteId) => {
    const note = board.notes[noteId];
    if (note?.type !== "youtube" || !note.youtube) return;
    const beforeLoop = note.youtube.loop;
    const nextLoop = beforeLoop ? undefined : true;
    execute({
      label: beforeLoop ? t("Stop looping YouTube video") : t("Loop YouTube video"),
      target: note.name,
      do: () => setYouTubeLoop(noteId, nextLoop),
      undo: () => setYouTubeLoop(noteId, beforeLoop),
    });
  },
  order: 70,
});

registerNoteMenuItem({
  id: "youtube.toggleFrame",
  label: (noteId) => board.notes[noteId]?.frameHidden ? t("Show node frame") : t("Hide node frame"),
  visible: (noteId) => board.notes[noteId]?.type === "youtube",
  run: (noteId) => {
    const note = board.notes[noteId];
    if (note?.type !== "youtube") return;
    const before = note.frameHidden;
    const frameHidden = before === true ? undefined : true;
    execute({
      label: frameHidden ? t("Hide YouTube node frame") : t("Show YouTube node frame"),
      target: note.name,
      do: () => updateNote(noteId, { frameHidden }),
      undo: () => updateNote(noteId, { frameHidden: before }),
    });
  },
  order: 75,
});

registerNoteMenuItem({
  id: "youtube.open",
  label: () => t("Open on YouTube"),
  visible: (noteId) => board.notes[noteId]?.type === "youtube" && Boolean(board.notes[noteId]?.youtube),
  run: (noteId) => {
    const note = board.notes[noteId];
    const url = note?.type === "youtube" ? note.youtube?.url : undefined;
    if (!url) return;
    void openUrl(url).catch(() => showLinkStatus(t("Could not open this YouTube link.")));
  },
  order: 80,
});

function setYouTubeLoop(noteId: string, loop: true | undefined): void {
  const current = board.notes[noteId];
  if (current?.type !== "youtube" || !current.youtube) return;
  const youtube = { ...current.youtube };
  if (loop) youtube.loop = true;
  else delete youtube.loop;
  updateNote(noteId, { youtube });
}
