import type { NoteKind } from "../model/note";
import { copyTimeNodeData } from "../time/data";
import type { TimeNodeData } from "../time/types";

export interface EmbedSectionState {
  /** Sections are expanded by default; only a collapsed section stores false. */
  message?: boolean;
  time?: boolean;
}

export function parseEmbedSections(value: unknown): EmbedSectionState | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.message !== undefined && typeof value.message !== "boolean" ||
    value.time !== undefined && typeof value.time !== "boolean") return null;
  return {
    ...(typeof value.message === "boolean" ? { message: value.message } : {}),
    ...(typeof value.time === "boolean" ? { time: value.time } : {}),
  };
}

export function copyEmbedSections(value: EmbedSectionState | undefined): EmbedSectionState | undefined {
  if (!value) return undefined;
  return {
    ...(value.message === undefined ? {} : { message: value.message }),
    ...(value.time === undefined ? {} : { time: value.time }),
  };
}

/** Embedded schedules always render in Time view; standalone Time nodes keep their chosen view. */
export function copyTimeForHost(type: NoteKind, value: TimeNodeData | undefined): TimeNodeData | undefined {
  if (!value) return undefined;
  const copied = copyTimeNodeData(value);
  if (type !== "time") copied.view = "time";
  return copied;
}

export function parseTimeForHost(type: NoteKind, value: TimeNodeData | undefined): TimeNodeData | undefined {
  return copyTimeForHost(type, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
