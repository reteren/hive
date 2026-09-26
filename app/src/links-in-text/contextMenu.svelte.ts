import type { Point } from "../board/cameraMath";

export type LinkContextMenu =
  /** x/y are the popup corner in board world units. */
  | { kind: "board"; x: number; y: number; point: Point }
  | { kind: "note"; x: number; y: number; noteId: string };

export const linkContext = $state({
  menu: null as LinkContextMenu | null,
  commandNoteId: null as string | null,
  commandPoint: null as Point | null,
  status: "",
});

let statusTimer: ReturnType<typeof setTimeout> | null = null;

export function showLinkStatus(message: string): void {
  linkContext.status = message;
  if (statusTimer !== null) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    linkContext.status = "";
    statusTimer = null;
  }, 2400);
}

export function closeLinkContextMenu(): void {
  linkContext.menu = null;
}
