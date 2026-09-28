import type { Note } from "../model/note";
import type { ListItem } from "../model/nodeData";
import type { Link } from "../model/link";
import { statisticsForListRow, type ListRowStatistics } from "./listStatistics";
import type { NoteFrame } from "../selection/gestures";
import { listStatisticsMeasurements } from "./listStatsMeasurements.svelte";

export const LIST_STATS_MIN_WIDTH = 12;
type StatisticsHost = Pick<Note, "type" | "listStats"> & { id?: string };

/** Measure natural text, including cell padding and the panel's separating border. */
export function fittedListStatisticsWidth(contentWidthPx: number, pxPerUnit = 10): number {
  return Math.max(LIST_STATS_MIN_WIDTH, Math.ceil(Math.max(0, contentWidthPx) + 1) / pxPerUnit);
}

/** Persisted width remains the main List width, including for projects saved before this panel. */
export function listStatisticsWidth(note: StatisticsHost): number {
  return note.type === "list" && note.listStats === true
    ? (note.id ? listStatisticsMeasurements[note.id] : undefined) ?? LIST_STATS_MIN_WIDTH : 0;
}
export function widthWithListStatistics(note: StatisticsHost & Pick<Note, "width">): number {
  return note.width + listStatisticsWidth(note);
}

/** Gesture frames describe the whole rendered node; the model stores only its main width. */
export function geometryFromListStatisticsFrame(note: StatisticsHost, frame: NoteFrame & { statisticsExtensionWidth?: number }): Pick<Note, "x" | "y" | "width" | "height"> {
  const extension = frame.statisticsExtensionWidth ?? listStatisticsWidth(note);
  return { x: frame.x, y: frame.y, width: frame.width - extension, height: frame.height };
}

export function listStatisticsFrameLimits(note: StatisticsHost, minimum: number, maximum: number): { minWidth?: number; maxWidth: number; statisticsExtensionWidth?: number } {
  const extension = listStatisticsWidth(note);
  // The gesture owns its initial panel width even if live counters or font loading change it.
  return extension ? { minWidth: minimum + extension, maxWidth: maximum + extension, statisticsExtensionWidth: extension } : { maxWidth: maximum };
}

/** Cells share the exact visual row sequence, including the empty live drag slot. */
export function alignedListStatistics(listId: string, rows: readonly { item: ListItem | null }[], notes: Readonly<Record<string, Note>>, links: Readonly<Record<string, Link>>): Array<ListRowStatistics | null> {
  return rows.map(({ item }) => item ? statisticsForListRow(listId, item, notes, links) : null);
}

export interface ExtensionGeometry {
  left: number;
  top: number;
  height: number;
  cellLeft: number;
}
/** Unscaled CSS pixels relative to the List body and its row wrappers. */
export function listExtensionGeometry(baseWidth: number, bodyLeft: number, bodyTop: number, rowsLeft: number, rowsBottom: number, headerTop: number): ExtensionGeometry {
  return {
    left: baseWidth - bodyLeft,
    top: headerTop - bodyTop,
    height: Math.max(28, rowsBottom - headerTop),
    cellLeft: baseWidth - rowsLeft,
  };
}
