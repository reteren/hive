/**
 * Notes the user just created get one unfold animation when they first mount.
 * A plain map (not state): notes mount and unmount while the camera moves, and only a mount within
 * a moment of creation should play it.
 */
const FRESH_MS = 600;
const created = new Map<string, number>();

export function markNoteFresh(id: string): void {
  created.set(id, performance.now());
}

/** True once for a note mounted right after it was created; later mounts stay still. */
export function takeFreshNote(id: string): boolean {
  const at = created.get(id);
  if (at === undefined) return false;
  created.delete(id);
  return performance.now() - at < FRESH_MS;
}
