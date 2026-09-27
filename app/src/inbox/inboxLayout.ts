import type { Note } from "../model/note";
import { board } from "../model/board.svelte";
import { links } from "../model/links.svelte";

/** Inbox row sizing is expressed in board units (10 CSS pixels at zoom 1). */
export const INBOX_ROW_HEIGHT = 2.4;
export const INBOX_MIN_ROWS = 2;

const INBOX_FIXED_CHROME_HEIGHT = 7.8;
const INBOX_EMPTY_MESSAGE_HEIGHT = 0;

/** Natural total node height for an Inbox showing its strong outgoing entries. */
export function inboxAutoHeight(note: Note): number {
  const entryCount = Object.values(links.byId).filter((link) =>
    link.from === note.id && link.kind === "strong" && Boolean(board.notes[link.to]),
  ).length;
  return inboxHeightForEntryCount(entryCount);
}

/** Pure height calculation used by placement and sizing tests. */
export function inboxHeightForEntryCount(entryCount: number): number {
  const rows = Number.isFinite(entryCount) ? Math.max(0, Math.floor(entryCount)) : 0;
  return INBOX_FIXED_CHROME_HEIGHT + (rows === 0 ? INBOX_EMPTY_MESSAGE_HEIGHT : rows * INBOX_ROW_HEIGHT);
}

/** Minimum full-node height: fixed chrome plus two readable entry rows. */
export function inboxMinHeight(_note: Note): number {
  return inboxHeightForEntryCount(INBOX_MIN_ROWS);
}
