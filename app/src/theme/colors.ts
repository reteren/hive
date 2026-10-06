export interface ThemeColors {
  base: string;
  accent: string;
  icon: string;
  board: string;
  grid: string;
}

export interface ThemeTokens {
  "--bg-panel": string;
  "--bg-panel-raised": string;
  "--bg-hover": string;
  "--border": string;
  "--accent": string;
  "--accent-hover": string;
  "--accent-rgb": string;
  "--on-accent": string;
  "--icon": string;
  "--icon-dim": string;
  "--bg-board": string;
  "--grid-minor": string;
  "--grid-major": string;
  "--axis": string;
  "--text": string;
  "--text-dim": string;
}

export const DEFAULT_THEME_COLORS: Readonly<ThemeColors> = {
  base: "#232323",
  accent: "#e8b030",
  icon: "#ffffff",
  board: "#161616",
  grid: "#ffffff",
};

export function normalizeHex(value: unknown): string | null {
  return typeof value === "string" && /^#[\da-f]{6}$/iu.test(value) ? value.toLowerCase() : null;
}

export function normalizeThemeColors(value: unknown, fallback: Readonly<ThemeColors> = DEFAULT_THEME_COLORS): ThemeColors {
  const input = asRecord(value);
  return {
    base: normalizeHex(input.base) ?? fallback.base,
    accent: normalizeHex(input.accent) ?? fallback.accent,
    icon: normalizeHex(input.icon) ?? fallback.icon,
    board: normalizeHex(input.board) ?? fallback.board,
    grid: normalizeHex(input.grid) ?? fallback.grid,
  };
}

export function deriveThemeTokens(colors: Readonly<ThemeColors>): ThemeTokens {
  const lightBase = relativeLuminance(colors.base) > 0.5;
  const accentRgb = rgbString(colors.accent);
  const gridRgb = rgbString(colors.grid);
  const darkGrid = relativeLuminance(colors.grid) < 0.5;
  const iconRgb = rgbString(colors.icon);

  return {
    "--bg-panel": colors.base,
    "--bg-panel-raised": mixHex(colors.base, "#ffffff", 0.04),
    "--bg-hover": mixHex(colors.base, "#ffffff", 0.08),
    "--border": mixHex(colors.base, "#000000", 0.6),
    "--accent": colors.accent,
    "--accent-hover": mixHex(colors.accent, "#ffffff", 0.12),
    "--accent-rgb": accentRgb,
    "--on-accent": contrastText(colors.accent),
    "--icon": colors.icon,
    "--icon-dim": `rgba(${iconRgb}, 0.58)`,
    "--bg-board": colors.board,
    // Dark grid lines need more alpha than light ones to read equally on a light board.
    "--grid-minor": `rgba(${gridRgb}, ${darkGrid ? 0.09 : 0.05})`,
    "--grid-major": `rgba(${gridRgb}, ${darkGrid ? 0.17 : 0.1})`,
    "--axis": `rgba(${accentRgb}, 0.28)`,
    "--text": lightBase ? "#202124" : "#d6d6d6",
    "--text-dim": lightBase ? "#55585e" : "#a0a0a0",
  };
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function mixHex(foreground: string, background: string, amount: number): string {
  const a = parseHex(foreground);
  const b = parseHex(background);
  const weight = Math.min(1, Math.max(0, amount));
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * weight).toString(16).padStart(2, "0")).join("")}`;
}

export function blendColor(foreground: string, background: string, alpha: number): string {
  return mixHex(background, foreground, alpha);
}

function contrastText(hex: string): string {
  return contrastRatio(hex, "#000000") >= contrastRatio(hex, "#ffffff") ? "#000000" : "#ffffff";
}

function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function rgbString(hex: string): string {
  return parseHex(hex).join(", ");
}

function parseHex(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex);
  if (!normalized) throw new Error(`Invalid theme colour: ${hex}`);
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
