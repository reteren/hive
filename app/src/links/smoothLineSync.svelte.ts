import { board } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import { noteBounds } from "../notes/layout.svelte";
import { reflowSmoothLineAnchorsRaw } from "./smoothLines";

let started = false;

/** Reflow persistent smooth anchors after settled geometry or link topology changes. */
export function startSmoothLineSync(): void {
  if (started) return;
  started = true;

  $effect.root(() => {
    let previous = "";
    let pending = false;
    $effect(() => {
      const signature = geometrySignature();
      if (signature === previous) return;
      previous = signature;
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        reflowSmoothLineAnchorsRaw();
      });
    });
  });
}

function geometrySignature(): string {
  const noteGeometry = Object.values(board.notes).map((note) => {
    const bounds = noteBounds(note);
    return [note.id, note.smoothLines === true, bounds.x, bounds.y, bounds.width, bounds.height];
  });
  const linkTopology = Object.values(links.byId).map((link) => [link.id, link.from, link.to]);
  return JSON.stringify([noteGeometry, linkTopology]);
}
