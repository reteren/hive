import type { Note } from "../model/note";
import type { ListItem } from "../model/nodeData";
import type { Link } from "../model/link";
import { statisticsForListRow, type ListRowStatistics } from "./listStatistics";
import type { NoteFrame } from "../selection/gestures";

export const LIST_STATS_EXTENSION_WIDTH = 30;

/** Persisted width remains the main List width, including for projects saved before this panel. */
export function listStatisticsWidth(note: Pick<Note, "type" | "listStats">): number {
  return note.type === "list" && note.listStats === true ? LIST_STATS_EXTENSION_WIDTH : 0;
}
export function widthWithListStatistics(note: Pick<Note, "type" | "width" | "listStats">): number {
  return note.width + listStatisticsWidth(note);
}

/** Gesture frames describe the whole rendered node; the model stores only its main width. */
export function geometryFromListStatisticsFrame(note: Pick<Note, "type" | "listStats">, frame: NoteFrame): Pick<Note, "x" | "y" | "width" | "height"> {
  return { x: frame.x, y: frame.y, width: frame.width - listStatisticsWidth(note), height: frame.height };
}

export function listStatisticsFrameLimits(note: Pick<Note, "type" | "listStats">, minimum: number, maximum: number): { minWidth?: number; maxWidth: number } {
  const extension = listStatisticsWidth(note);
  return extension ? { minWidth: minimum + extension, maxWidth: maximum + extension } : { maxWidth: maximum };
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
