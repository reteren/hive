import { board } from "../model/board.svelte";

export const GIF_PLAYBACK_MODES = ["always", "hover", "selected"] as const;
export type GifPlaybackMode = (typeof GIF_PLAYBACK_MODES)[number];

export type GifPlaybackTarget =
  | { kind: "board"; noteId: string }
  | { kind: "inline"; noteId: string; position: number }
  | { kind: "tierlist"; noteId: string; rowId: string; cardId: string };

export interface GifContextMenuState {
  target: GifPlaybackTarget;
}

export const GIF_PLAYBACK_CHANGE_EVENT = "hive:gif-playback-change";

export const gifPlayback = $state({
  mode: "always" as GifPlaybackMode,
  inlineStopped: {} as Record<string, true | undefined>,
  contextMenu: null as GifContextMenuState | null,
});

export function normalizeGifPlaybackMode(value: unknown, fallback: GifPlaybackMode = "always"): GifPlaybackMode {
  return value === "always" || value === "hover" || value === "selected" ? value : fallback;
}

export function setGifPlaybackMode(value: unknown): void {
  const mode = normalizeGifPlaybackMode(value);
  if (gifPlayback.mode === mode) return;
  gifPlayback.mode = mode;
  notifyPlaybackChange();
}

export function shouldPlayGif(conditions: {
  mode: GifPlaybackMode;
  stopped: boolean;
  selected: boolean;
  hovered: boolean;
  hoverWhenSelected?: boolean;
}): boolean {
  if (conditions.stopped) return false;
  switch (conditions.mode) {
    case "always": return true;
    case "hover": return conditions.hovered;
    case "selected": return conditions.selected || (conditions.hoverWhenSelected === true && conditions.hovered);
  }
}

export function isGifStopped(target: GifPlaybackTarget): boolean {
  switch (target.kind) {
    case "board":
      return board.notes[target.noteId]?.gifStopped === true;
    case "inline":
      return gifPlayback.inlineStopped[inlineGifKey(target.noteId, target.position)] === true;
    case "tierlist": {
      const card = findTierCard(target);
      return (card?.kind === "image" || card?.kind === "note") && card.stopped === true;
    }
  }
}

/** GIF stop state is intentionally outside Undo; board and Tierlist targets persist in their models. */
export function setGifStopped(target: GifPlaybackTarget, stopped: boolean): void {
  switch (target.kind) {
    case "board": {
      const note = board.notes[target.noteId];
      if (note) {
        if (stopped) note.gifStopped = true;
        else delete note.gifStopped;
      }
      break;
    }
    case "inline": {
      const key = inlineGifKey(target.noteId, target.position);
      if (stopped) gifPlayback.inlineStopped[key] = true;
      else delete gifPlayback.inlineStopped[key];
      break;
    }
    case "tierlist": {
      const card = findTierCard(target);
      if (card?.kind === "image" || card?.kind === "note") {
        if (stopped) card.stopped = true;
        else delete card.stopped;
      }
      break;
    }
  }
  notifyPlaybackChange();
}

export function gifTargetFromElement(element: Element | null): GifPlaybackTarget | null {
  const surface = element?.closest<HTMLElement>("[data-gif-surface]");
  if (!surface) return null;
  const { gifTargetKind, gifNoteId, gifPosition, gifRowId, gifCardId } = surface.dataset;
  if (!gifNoteId) return null;
  if (gifTargetKind === "board") return { kind: "board", noteId: gifNoteId };
  if (gifTargetKind === "inline" && gifPosition !== undefined) {
    const position = Number(gifPosition);
    return Number.isSafeInteger(position) && position >= 0
      ? { kind: "inline", noteId: gifNoteId, position }
      : null;
  }
  if (gifTargetKind === "tierlist" && gifRowId && gifCardId) {
    return { kind: "tierlist", noteId: gifNoteId, rowId: gifRowId, cardId: gifCardId };
  }
  return null;
}

export function openGifContextMenu(target: GifPlaybackTarget): void {
  gifPlayback.contextMenu = { target };
}

export function closeGifContextMenu(): void {
  gifPlayback.contextMenu = null;
}

function findTierCard(target: Extract<GifPlaybackTarget, { kind: "tierlist" }>) {
  return board.notes[target.noteId]?.tiers
    ?.find((row) => row.id === target.rowId)
    ?.cards.find((card) => card.id === target.cardId);
}

function inlineGifKey(noteId: string, position: number): string {
  return `${noteId}\u0000${position}`;
}

function notifyPlaybackChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GIF_PLAYBACK_CHANGE_EVENT));
}
