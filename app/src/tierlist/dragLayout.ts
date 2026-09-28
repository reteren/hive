import type { TierCard, TierRow } from "../model/nodeData";
import type { ContentDragPreview, ContentSource, ContentTarget } from "../list/itemDrag";

const slotKey = Symbol("tier card drop slot");
export type TierDisplayCard = { id: string | symbol; card: TierCard | null };

/** Preview rearranges only rendered cards; the persisted tiers change on release. */
export function tierDragRows(rows: readonly TierRow[], noteId: string, preview: ContentDragPreview | null): Array<TierRow & { displayCards: TierDisplayCard[] }> {
  return rows.map((row) => {
    const source = preview?.source;
    const displayCards: TierDisplayCard[] = row.cards
      .filter((card) => !(source?.kind === "tierlist" && source.noteId === noteId && source.rowId === row.id && source.cardId === card.id))
      .map((card) => ({ id: card.id, card }));
    const target = preview?.target;
    if (target?.kind === "tierlist" && target.noteId === noteId && target.rowId === row.id) {
      displayCards.splice(target.index, 0, { id: slotKey, card: null });
    }
    return { ...row, displayCards };
  });
}

/** The existing move action accepts a slot before source removal, unlike the live layout. */
export function tierDropOriginalIndex(rows: readonly TierRow[], source: ContentSource, target: ContentTarget): number {
  if (source.kind !== "tierlist" || target.kind !== "tierlist" || source.noteId !== target.noteId || source.rowId !== target.rowId) return target.index;
  const from = rows.find((row) => row.id === source.rowId)?.cards.findIndex((card) => card.id === source.cardId) ?? -1;
  return from >= 0 && target.index > from ? target.index + 1 : target.index;
}
