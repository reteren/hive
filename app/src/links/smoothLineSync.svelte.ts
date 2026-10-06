import { board } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import { noteBounds } from "../notes/layout.svelte";
import { hasMeBeacon } from "../beacons/beaconState.svelte";
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
      // At most once per frame: dragging fires many geometry changes per frame.
      const run = () => {
        pending = false;
        reflowSmoothLineAnchorsRaw();
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
      else queueMicrotask(run);
    });
  });
}

/**
 * Only notes with smooth lines and the notes they are linked to affect smooth anchors; hashing every
 * note on every pointer move made dragging on a big board stutter.
 */
function geometrySignature(): string {
  const smooth = new Set<string>(hasMeBeacon() ? ["me"] : []);
  for (const note of Object.values(board.notes)) {
    if (note.type === "beacon" || note.smoothLines === true) smooth.add(note.id);
  }
  const relevant = new Set(smooth);
  const linkTopology: unknown[] = [];
  for (const link of Object.values(links.byId)) {
    if (!smooth.has(link.from) && !smooth.has(link.to)) continue;
    relevant.add(link.from);
    relevant.add(link.to);
    linkTopology.push([link.id, link.from, link.to]);
  }
  const noteGeometry: unknown[] = [];
  for (const id of relevant) {
    const note = board.notes[id];
    if (!note) continue;
    const bounds = noteBounds(note);
    noteGeometry.push([id, smooth.has(id), bounds.x, bounds.y, bounds.width, bounds.height]);
  }
  return JSON.stringify([noteGeometry, linkTopology]);
}
