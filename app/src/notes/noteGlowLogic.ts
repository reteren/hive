import type { Note, NoteGlow } from "../model/note";
import { normalizeHex } from "../color/hex";
import { BEACON_PALETTE } from "../beacons/beaconPalette";
import { PX_PER_UNIT } from "../board/cameraMath";

export const DEFAULT_GLOW_OPACITY = 0.55;
export const MIN_GLOW_OPACITY = 0.05;
export const MAX_GLOW_OPACITY = 1;
export const DEFAULT_GLOW_SIZE = 1.2;
export const MIN_GLOW_SIZE = 0.5;
export const MAX_GLOW_SIZE = 8;

const DEFAULT_FRAME_COLORS: Partial<Record<Note["type"], string>> = {
  pro: "#293d2e",
  con: "#422d2c",
  importance: "#292929",
  purpose: "#292929",
  mood: "#292929",
  goal: "#3b3422",
};

/** Validate the complete optional field; malformed glows are dropped as a unit. */
export function parseNoteGlow(value: unknown): NoteGlow | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const glow = value as Record<string, unknown>;
  const color = typeof glow.color === "string" && /^#[0-9a-f]{6}$/i.test(glow.color)
    ? normalizeHex(glow.color)
    : null;
  if (!color || typeof glow.opacity !== "number" || !Number.isFinite(glow.opacity) ||
    glow.opacity < MIN_GLOW_OPACITY || glow.opacity > MAX_GLOW_OPACITY ||
    typeof glow.size !== "number" || !Number.isFinite(glow.size) ||
    glow.size < MIN_GLOW_SIZE || glow.size > MAX_GLOW_SIZE) return undefined;
  return { color, opacity: glow.opacity, size: glow.size };
}

export function copyNoteGlow(glow: NoteGlow | undefined): NoteGlow | undefined {
  return glow ? { color: glow.color, opacity: glow.opacity, size: glow.size } : undefined;
}

/** A node's main colour, or the default colour of the frame it renders. */
export function mainNoteColor(note: Pick<Note, "type" | "color">): string {
  if (note.type === "beacon") return normalizeHex(note.color ?? "") ?? BEACON_PALETTE[0];
  return normalizeHex(note.color ?? "") ?? DEFAULT_FRAME_COLORS[note.type] ?? "#353535";
}

export function defaultNoteGlow(note: Pick<Note, "type" | "color">): NoteGlow {
  return { color: mainNoteColor(note), opacity: DEFAULT_GLOW_OPACITY, size: DEFAULT_GLOW_SIZE };
}

/** Beacon glow is fixed to its main colour and geometry, independent of stored legacy values. */
export function defaultBeaconGlow(note: Pick<Note, "type" | "color">): NoteGlow {
  return { color: mainNoteColor({ ...note, type: "beacon" }), opacity: 1, size: 6.2 };
}

export function noteGlowShadow(glow: NoteGlow): string {
  const red = Number.parseInt(glow.color.slice(1, 3), 16);
  const green = Number.parseInt(glow.color.slice(3, 5), 16);
  const blue = Number.parseInt(glow.color.slice(5, 7), 16);
  const color = `rgb(${red} ${green} ${blue} / ${glow.opacity})`;
  const blur = `${(glow.size * PX_PER_UNIT).toFixed(1)}px`;
  const innerBlur = `${(glow.size * PX_PER_UNIT * 0.45).toFixed(1)}px`;
  return `0 0 ${blur} 0 ${color}, 0 0 ${innerBlur} 0 ${color}`;
}
