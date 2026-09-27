import { board, updateNote } from "../model/board.svelte";
import { zones } from "../model/zones.svelte";
import { newId } from "../model/note";
import type { ListItem, TierCard } from "../model/nodeData";
import type { HistoryCommand } from "../history/history.svelte";
import { addTierCard, copyTierRows, deleteTierCard, effectiveTierRows, markTierHintsDismissed } from "../tierlist/logic";
import { copyListItems, insertListItem, removeListItem } from "./logic";
import type { ContentSource, ContentTarget } from "./itemDrag";

/** Cross-node content moves own both snapshots, so one Undo restores both sides. */
export function createContentMoveCommand(source: ContentSource, target: ContentTarget): HistoryCommand | null {
  const sourceNote = board.notes[source.noteId];
  const targetNote = board.notes[target.noteId];
  if (!sourceNote || !targetNote || sourceNote.type !== source.kind || targetNote.type !== target.kind) return null;
  if (source.kind === "tierlist" && target.kind === "tierlist") return null;
  const sourceItems = copyListItems(sourceNote.listItems ?? []);
  const targetItems = copyListItems(targetNote.listItems ?? []);
  const sourceTiers = effectiveTierRows(sourceNote);
  const targetTiers = effectiveTierRows(targetNote);
  const item = source.kind === "list" ? sourceItems.find((row) => row.id === source.itemId) : undefined;
  const card = source.kind === "tierlist"
    ? sourceTiers.find((row) => row.id === source.rowId)?.cards.find((row) => row.id === source.cardId)
    : undefined;
  if (!item && !card) return null;

  if (source.kind === "list" && target.kind === "list" && source.noteId === target.noteId) {
    const after = insertListItem(removeListItem(sourceItems, source.itemId), item!, target.index);
    if (JSON.stringify(after) === JSON.stringify(sourceItems)) return null;
    return {
      label: "Reorder List rows", target: sourceNote.name,
      do: () => updateNote(sourceNote.id, { listItems: copyListItems(after) }),
      undo: () => updateNote(sourceNote.id, { listItems: copyListItems(sourceItems) }),
    };
  }

  let nextSourceItems = sourceItems;
  let nextSourceTiers = sourceTiers;
  if (source.kind === "list") nextSourceItems = removeListItem(sourceItems, source.itemId);
  else nextSourceTiers = deleteTierCard(sourceTiers, source.rowId, source.cardId);
  let nextTargetItems = targetItems;
  let nextTargetTiers = targetTiers;
  if (target.kind === "list") {
    const nextItem: ListItem = item ? { ...item } : card!.kind === "text"
      ? { id: newId(), targetId: null, label: card!.text }
      : { id: newId(), targetId: card!.noteId, label: board.notes[card!.noteId]?.name ?? zones.byId[card!.noteId]?.name ?? "content missing" };
    if (targetItems.some((row) => row.id === nextItem.id)) nextItem.id = newId();
    nextTargetItems = insertListItem(targetItems, nextItem, target.index);
  } else {
    if (!targetTiers.some((row) => row.id === target.rowId)) return null;
    const nextCard: TierCard = item!.targetId === null
      ? { id: newId(), kind: "text", text: item!.label }
      : { id: newId(), kind: "note", noteId: item!.targetId };
    nextTargetTiers = markTierHintsDismissed(addTierCard(targetTiers, target.rowId, nextCard, target.index));
  }

  return {
    label: "Move list content", target: `${sourceNote.name} → ${targetNote.name}`,
    do: () => {
      if (source.kind === "list") updateNote(sourceNote.id, { listItems: copyListItems(nextSourceItems) });
      else updateNote(sourceNote.id, { tiers: copyTierRows(nextSourceTiers) });
      if (target.kind === "list") updateNote(targetNote.id, { listItems: copyListItems(nextTargetItems) });
      else updateNote(targetNote.id, { tiers: copyTierRows(nextTargetTiers) });
    },
    undo: () => {
      if (source.kind === "list") updateNote(sourceNote.id, { listItems: copyListItems(sourceItems) });
      else updateNote(sourceNote.id, { tiers: copyTierRows(sourceTiers) });
      if (target.kind === "list") updateNote(targetNote.id, { listItems: copyListItems(targetItems) });
      else updateNote(targetNote.id, { tiers: copyTierRows(targetTiers) });
    },
  };
}
