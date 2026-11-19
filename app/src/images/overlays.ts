import { board } from "../model/board.svelte";

/** Text boxes laid over the given image ("Add text box"): they move together with it. */
export function imageOverlayIds(imageId: string): string[] {
  return board.order.filter((id) => board.notes[id]?.overlayOf === imageId);
}
