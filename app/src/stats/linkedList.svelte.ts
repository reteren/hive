import { board } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import type { ListItem } from "../model/nodeData";
import type { Note } from "../model/note";
import { formatLinkedListRow, statisticsForListRow } from "./listStatistics";

export interface StatisticsListRow {
  item: ListItem;
  text: string;
}

export interface StatisticsListView {
  list: Note;
  rows: StatisticsListRow[];
}

/** The newest live strong Statistics → List link selects this row-by-row view. */
export function linkedListForStats(noteId: string): Note | null {
  if (board.notes[noteId]?.type !== "stats") return null;
  const matching = Object.values(links.byId).filter((link) =>
    link.from === noteId && link.kind === "strong" && board.notes[link.to]?.type === "list");
  const listId = matching.at(-1)?.to;
  return listId ? board.notes[listId] ?? null : null;
}

export function listViewForStats(noteId: string): StatisticsListView | null {
  const list = linkedListForStats(noteId);
  if (!list) return null;
  const rows = (list.listItems ?? []).map((item) => ({
    item,
    text: formatLinkedListRow(statisticsForListRow(list.id, item, board.notes, links.byId)),
  }));
  return { list, rows };
}
