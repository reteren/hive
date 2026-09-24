/** Distinct, legible colours on the dark board. New beacons cycle through this palette. */
export const BEACON_PALETTE = ["#e8b030", "#69b7a5", "#8ca9e8", "#d68bba", "#e38b72", "#a9b979"] as const;

export function beaconPaletteColor(index: number): string {
  return BEACON_PALETTE[index % BEACON_PALETTE.length];
}

export function normalizeBeaconColor(value: string): string | null {
  const raw = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.slice(1).split("").map((digit) => digit.repeat(2)).join("").toLowerCase()}`;
  }
  return null;
}
