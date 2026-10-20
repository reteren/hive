import { board, updateNote } from "../model/board.svelte";
import { NOTE_HEADER_HEIGHT_UNITS, type Note } from "../model/note";
import { editing } from "./editing.svelte";
import { selection } from "../selection/selection.svelte";
import { linksOf } from "../model/links.svelte";
import { execute } from "../history/history.svelte";
import { toggleSmoothLinesForNote } from "../links/smoothLines";
import { menuShortcutLabel } from "../commands/menuShortcut";
import { runNoteMenuCommand } from "../commands/objectMenu";
import { camera } from "../board/camera.svelte";
import { linkContext } from "../links-in-text/contextMenu.svelte";
import { openImageOpacityPopover } from "../images/imageOpacity.svelte";
import { copyImageNoteToClipboard } from "../images/imageClipboard";
import {
  closeGifContextMenu,
  gifPlayback,
  isGifStopped,
  setGifStopped,
  type GifPlaybackTarget,
} from "../attachments/gifPlayback.svelte";
import { t, tp } from "../i18n/i18n.svelte";

/**
 * Items of the note right-click menu. Features register their entries here instead of editing
 * the menu component (R3: Task, Add Importance, Add Purpose, …).
 */
export interface NoteMenuItem {
  id: string;
  /** Label shown in the menu; may depend on the note (e.g. "Mark as task" / "Unmark task"). */
  label: (noteId: string) => string;
  run: (noteId: string) => void;
  /** Hide the item for notes it doesn't apply to. */
  visible?: (noteId: string) => boolean;
  /** Current command binding, displayed separately from the action label. */
  shortcut?: (noteId: string) => string;
  /** Add a thin separator before this row. */
  dividerBefore?: boolean;
  /** Lower comes first. */
  order?: number;
}

const items = new Map<string, NoteMenuItem>();
const UNIVERSAL_MENU_IDS = new Set([
  "object.scale", "object.grab", "object.delete", "notes.glow.edit", "notes.glow.remove", "object.info",
]);

/** A hidden header is a move handle only; its title can be renamed after it is shown. */
export function canRenameNoteHeader(headerHidden: boolean | undefined): boolean {
  return headerHidden !== true;
}

const REMOVED_CONTEXT_MENU_IDS = new Set([
  "notes.addPlus", "notes.addMinus", "module.importance", "module.purpose", "module.mood",
]);

/** Apply the intentionally compact menu allowed for images and GIF surfaces. */
export function noteMenuItemsForContext(
  noteId: string,
  gifTarget: GifPlaybackTarget | null = null,
): NoteMenuItem[] {
  const note = board.notes[noteId];
  const allItems = noteMenuItems(noteId);
  const target = gifTarget?.noteId === noteId ? gifTarget : null;

  if (note?.type === "image") {
    const allowed = new Set(["notes.copyLink", "image.copyToClipboard", "image.erase", "image.opacity", "archive.note", ...UNIVERSAL_MENU_IDS]);
    if (note.task) allowed.add("task.toggleFlag");
    if (note.image?.mime === "image/gif" && target?.kind === "board") {
      allowed.add("attachments.toggleGif");
    }
    return allItems.filter((item) => allowed.has(item.id));
  }

  if (target) {
    return allItems.filter((item) => UNIVERSAL_MENU_IDS.has(item.id) || item.id === "attachments.toggleGif" || item.id === "task.toggleFlag" && Boolean(note?.task));
  }
  return allItems;
}

registerNoteMenuItem({
  id: "attachments.toggleGif",
  label: (noteId) => {
    const target = gifPlayback.contextMenu?.target;
    return target?.noteId === noteId && isGifStopped(target) ? t("Play gif") : t("Stop gif");
  },
  run: (noteId) => {
    const target = gifPlayback.contextMenu?.target;
    if (target?.noteId !== noteId) return;
    setGifStopped(target, !isGifStopped(target));
    closeGifContextMenu();
  },
  visible: (noteId) => gifPlayback.contextMenu?.target.noteId === noteId,
  order: 11,
});

registerNoteMenuItem({
  id: "image.copyToClipboard",
  label: () => t("Copy to clipboard"),
  run: (noteId) => { void copyImageNoteToClipboard(noteId); },
  visible: (noteId) => board.notes[noteId]?.type === "image" && Boolean(board.notes[noteId]?.image),
  order: 9,
});

registerNoteMenuItem({
  id: "image.opacity",
  label: () => t("Opacity…"),
  run: (noteId) => {
    const menu = linkContext.menu;
    if (menu?.kind === "note" && menu.noteId === noteId) {
      openImageOpacityPopover(noteId, { x: menu.x, y: menu.y }, camera.zoom);
    }
  },
  visible: (noteId) => board.notes[noteId]?.type === "image",
  order: 12,
});

registerNoteMenuItem({
  id: "links.smoothLines",
  label: (noteId) => board.notes[noteId]?.smoothLines ? t("Remove smooth") : t("Smooth lines"),
  run: toggleSmoothLinesForNote,
  visible: (noteId) => board.notes[noteId]?.type !== "beacon" &&
    (board.notes[noteId]?.smoothLines === true || linksOf(noteId).length > 0),
  order: 85,
});

registerNoteMenuItem({
  id: "notes.toggleHeader",
  label: (noteId) => {
    const targets = noteHeaderTargets(noteId);
    return targets.length > 0 && targets.every((id) => board.notes[id]?.headerHidden === true)
      ? t("Show header")
      : t("Hide header");
  },
  run: toggleNoteHeader,
  // A node without its text box is only its header; hiding that too would leave nothing to see.
  visible: (noteId) => Boolean(board.notes[noteId] && board.notes[noteId].type !== "beacon" && board.notes[noteId].type !== "image" &&
    board.notes[noteId].textHidden !== true),
  order: 90,
});

registerNoteMenuItem({
  id: "notes.toggleTextBox",
  label: (noteId) => {
    const targets = noteTextBoxTargets(noteId);
    return targets.length > 0 && targets.every((id) => board.notes[id]?.textHidden === true)
      ? t("Show text box")
      : t("Remove text box");
  },
  run: toggleNoteTextBox,
  visible: (noteId) => noteTextBoxTargets(noteId).includes(noteId),
  order: 91,
});

registerNoteMenuItem({
  id: "object.scale",
  label: () => t("Scale"),
  shortcut: () => menuShortcutLabel("select.scale"),
  run: (noteId) => runNoteMenuCommand(noteId, "select.scale"),
  dividerBefore: true,
  order: 1000,
});

registerNoteMenuItem({
  id: "object.grab",
  label: () => t("Grab"),
  shortcut: () => menuShortcutLabel("select.move"),
  run: (noteId) => runNoteMenuCommand(noteId, "select.move"),
  order: 1001,
});

registerNoteMenuItem({
  id: "object.delete",
  label: () => t("Delete"),
  shortcut: () => menuShortcutLabel("edit.delete"),
  run: (noteId) => runNoteMenuCommand(noteId, "edit.delete"),
  order: 1002,
});

/** The RMB target expands to the selection only when it is already selected. */
export function noteHeaderTargets(noteId: string): string[] {
  const ids = selection.ids.includes(noteId) ? selection.ids : [noteId];
  return ids.filter((id) => {
    const note = board.notes[id];
    return Boolean(note && note.type !== "beacon" && note.type !== "image" && note.textHidden !== true);
  });
}

function toggleNoteHeader(noteId: string): void {
  const targets = noteHeaderTargets(noteId);
  if (targets.length === 0) return;

  const hide = !targets.every((id) => board.notes[id]?.headerHidden === true);
  const changes = new Map<string, {
    before: { headerHidden: boolean | undefined; height: number | null };
    after: { headerHidden: boolean; height: number | null };
  }>();
  for (const id of targets) {
    const note = board.notes[id];
    if (!note || note.headerHidden === hide) continue;
    changes.set(id, {
      before: { headerHidden: note.headerHidden, height: note.height },
      after: {
        headerHidden: hide,
        height: note.height === null
          ? null
          : Math.max(0.1, note.height + (hide ? -NOTE_HEADER_HEIGHT_UNITS : NOTE_HEADER_HEIGHT_UNITS)),
      },
    });
  }
  if (changes.size === 0) return;

  const firstChangedId = changes.keys().next().value as string;
  execute({
    label: hide ? t("Hide header") : t("Show header"),
    target: changes.size === 1 ? board.notes[firstChangedId]?.name ?? t("node") : tp(changes.size, "{count} node", "{count} nodes"),
    do: () => {
      for (const [id, change] of changes) {
        updateNote(id, change.after);
      }
    },
    undo: () => {
      for (const [id, change] of changes) {
        updateNote(id, change.before);
      }
    },
  });
}

/** Plain text nodes with a visible header (Task / Message combos keep their body). */
export function hasRemovableTextBox(note: Note | undefined): boolean {
  return Boolean(note && (note.type === "note" || note.type === "pro" || note.type === "con") &&
    note.message === undefined && note.time === undefined && note.headerHidden !== true);
}

/** The RMB target expands to the selection only when it is already selected. */
export function noteTextBoxTargets(noteId: string): string[] {
  const ids = selection.ids.includes(noteId) ? selection.ids : [noteId];
  return ids.filter((id) => hasRemovableTextBox(board.notes[id]));
}

/**
 * Remove (or bring back) the text box: the node shrinks to its header. The text itself stays in
 * the node, so it is all there again when the box returns; the node then grows with its text.
 */
function toggleNoteTextBox(noteId: string): void {
  const targets = noteTextBoxTargets(noteId);
  if (targets.length === 0) return;

  const hide = !targets.every((id) => board.notes[id]?.textHidden === true);
  const changes = new Map<string, {
    before: { textHidden: boolean | undefined; height: number | null };
    after: { textHidden: true | undefined; height: number | null };
  }>();
  for (const id of targets) {
    const note = board.notes[id];
    if (!note || (note.textHidden === true) === hide) continue;
    changes.set(id, {
      before: { textHidden: note.textHidden, height: note.height },
      after: { textHidden: hide ? true : undefined, height: null },
    });
  }
  if (changes.size === 0) return;
  if (hide && editing.noteId && changes.has(editing.noteId)) editing.noteId = null;

  const firstChangedId = changes.keys().next().value as string;
  execute({
    label: hide ? t("Remove text box") : t("Show text box"),
    target: changes.size === 1 ? board.notes[firstChangedId]?.name ?? t("node") : tp(changes.size, "{count} node", "{count} nodes"),
    do: () => {
      for (const [id, change] of changes) {
        updateNote(id, change.after);
      }
    },
    undo: () => {
      for (const [id, change] of changes) {
        updateNote(id, change.before);
      }
    },
  });
}

export function registerNoteMenuItem(item: NoteMenuItem): void {
  items.set(item.id, item);
}

export function noteMenuItems(noteId: string): NoteMenuItem[] {
  const note = board.notes[noteId];
  return [...items.values()]
    .filter((item) => !REMOVED_CONTEXT_MENU_IDS.has(item.id))
    .filter((item) => !(note?.type === "beacon" && !note.task && /^tasks?\./i.test(item.id)))
    .filter((item) => item.visible?.(noteId) ?? true)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
