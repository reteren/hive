import { pointer } from "../board/camera.svelte";
import { board } from "../model/board.svelte";
import { zones } from "../model/zones.svelte";
import { zoneMembers, zoneOf } from "../zones/membership.svelte";
import { hitTestZones } from "./hitTesting";
import { selection, setSelectionUndoable, captureSelectionSnapshot } from "./selection.svelte";
import { selectedLinkIds } from "../links/selection.svelte";
import { t } from "../i18n/i18n.svelte";

/** A second tap of A within this time selects every node of the project. */
export const SELECT_TAP_REPEAT_MS = 450;

let lastTapAt = Number.NEGATIVE_INFINITY;

/** Which nodes a tap of A selects: the hovered zone's members, else every node outside zones. */
export function nodesForSelectTap(
  zoneId: string | null,
  order: readonly string[],
  members: (zoneId: string) => readonly string[],
  zoneOfNode: (id: string) => string | null,
): string[] {
  if (zoneId) {
    const inZone = new Set(members(zoneId));
    return order.filter((id) => inZone.has(id));
  }
  return order.filter((id) => zoneOfNode(id) === null);
}

function selectIds(ids: readonly string[], label: string): void {
  const next = captureSelectionSnapshot();
  next.ids = [...ids];
  next.zoneIds = [];
  next.primaryId = ids.at(-1) ?? null;
  setSelectionUndoable(next, label);
}

/**
 * Tap A on the board with nothing selected: select the nodes of the zone under the cursor, or all
 * nodes outside zones. Tap again quickly: select every node of the project.
 */
export function handleSelectTap(now = performance.now()): boolean {
  const repeat = now - lastTapAt <= SELECT_TAP_REPEAT_MS;
  const nothingSelected = selection.ids.length === 0 && selection.zoneIds.length === 0 && selectedLinkIds().length === 0;
  if (!repeat && !nothingSelected) return false;
  lastTapAt = repeat ? Number.NEGATIVE_INFINITY : now;
  const order = board.order.filter((id) => board.notes[id]);
  if (repeat) {
    selectIds(order, t("Select all nodes"));
    return true;
  }
  const point = pointer.world;
  const zoneId = point ? hitTestZones(point, zones.byId, zones.order) : null;
  selectIds(nodesForSelectTap(zoneId, order, zoneMembers, zoneOf), zoneId ? t("Select zone nodes") : t("Select nodes outside zones"));
  return true;
}
