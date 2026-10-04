/** Hue 0–360, saturation and value 0–1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** "#abc", "abc", "#AABBCC" → "#aabbcc"; anything else → null. */
export function normalizeHex(value: string): string | null {
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split("").map((digit) => digit.repeat(2)).join("").toLowerCase()}`;
  return null;
}

export function hexToHsv(hex: string): Hsv {
  const normalized = normalizeHex(hex) ?? "#000000";
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const val = clamp01(v);
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
