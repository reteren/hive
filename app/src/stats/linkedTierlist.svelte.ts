import { board } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import type { Note } from "../model/note";
import { effectiveTierRows } from "../tierlist/logic";
import { summarizeTierlist, type TierlistStatistics } from "./statistics";

export interface StatisticsTierlistView {
  tierlist: Note;
  summary: TierlistStatistics;
}

/** Null restores the ordinary text-statistics view and its saved scope. */
export function tierlistViewForStats(noteId: string): StatisticsTierlistView | null {
  const tierlist = linkedTierlistForStats(noteId);
  return tierlist ? { tierlist, summary: summarizeTierlist(effectiveTierRows(tierlist)) } : null;
}

/** The newest live strong Statistics → Tierlist link selects the Tierlist view. */
export function linkedTierlistForStats(noteId: string): Note | null {
  if (board.notes[noteId]?.type !== "stats") return null;
  const matching = Object.values(links.byId).filter((link) =>
    link.from === noteId && link.kind === "strong" && board.notes[link.to]?.type === "tierlist");
  const tierlistId = matching.at(-1)?.to;
  return tierlistId ? board.notes[tierlistId] ?? null : null;
}
