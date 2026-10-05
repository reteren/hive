export interface LinkGradientStop {
  offset: number;
  color: string;
}

interface Oklch {
  lightness: number;
  chroma: number;
  hue: number;
}

interface Rgba {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

const STOP_COUNT = 7;
const CACHE_LIMIT = 256;
const CHROMA_EPSILON = 1e-5;
const GAMUT_EPSILON = 1e-7;
const gradientCache = new Map<string, readonly LinkGradientStop[] | null>();

/** Return cached, perceptually interpolated stops for a pair of note colours. */
export function linkColorGradientStops(
  fromColor: string,
  toColor: string,
): readonly LinkGradientStop[] | null {
  const from = parseHexColor(fromColor);
  const to = parseHexColor(toColor);
  if (!from || !to) return null;

  const key = `${from.hex}|${to.hex}`;
  if (gradientCache.has(key)) {
    const cached = gradientCache.get(key) ?? null;
    // Refresh insertion order so frequently used pairs stay in the small cache.
    gradientCache.delete(key);
    gradientCache.set(key, cached);
    return cached;
  }

  const stops = from.hex === to.hex
    ? null
    : buildStops(from.color, to.color);
  gradientCache.set(key, stops);
  if (gradientCache.size > CACHE_LIMIT) {
    const oldest = gradientCache.keys().next().value;
    if (oldest !== undefined) gradientCache.delete(oldest);
  }
  return stops;
}

function buildStops(from: Rgba, to: Rgba): readonly LinkGradientStop[] {
  const start = toOklch(from);
  const end = toOklch(to);
  const startHue = start.chroma < CHROMA_EPSILON ? end.hue : start.hue;
  const endHue = end.chroma < CHROMA_EPSILON ? start.hue : end.hue;
  const hueDelta = shortestHueDelta(startHue, endHue);
  const keepAlpha = from.alpha < 1 || to.alpha < 1;
  const stops: LinkGradientStop[] = [];

  for (let index = 0; index < STOP_COUNT; index += 1) {
    const amount = index / (STOP_COUNT - 1);
    const color = index === 0
      ? from
      : index === STOP_COUNT - 1
        ? to
        : fromOklch({
            lightness: lerp(start.lightness, end.lightness, amount),
            chroma: lerp(start.chroma, end.chroma, amount),
            hue: startHue + hueDelta * amount,
          }, lerp(from.alpha, to.alpha, amount));
    stops.push({ offset: amount * 100, color: rgbaToHex(color, keepAlpha) });
  }

  return Object.freeze(stops.map((stop) => Object.freeze(stop)));
}

function parseHexColor(input: string): { color: Rgba; hex: string } | null {
  const value = input.trim().toLowerCase();
  if (!/^#[\da-f]+$/i.test(value)) return null;

  let digits = value.slice(1);
  if (digits.length === 3 || digits.length === 4) {
    digits = [...digits].map((digit) => `${digit}${digit}`).join("");
  }
  if (digits.length !== 6 && digits.length !== 8) return null;

  const red = Number.parseInt(digits.slice(0, 2), 16) / 255;
  const green = Number.parseInt(digits.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(digits.slice(4, 6), 16) / 255;
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
  const color = { red, green, blue, alpha };
  return { color, hex: rgbaToHex(color, alpha < 1) };
}

function toOklch(color: Rgba): Oklch {
  const red = srgbToLinear(color.red);
  const green = srgbToLinear(color.green);
  const blue = srgbToLinear(color.blue);

  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { lightness, chroma: Math.hypot(a, b), hue: Math.atan2(b, a) };
}

function fromOklch(color: Oklch, alpha: number): Rgba {
  const a = color.chroma * Math.cos(color.hue);
  const b = color.chroma * Math.sin(color.hue);

  const lRoot = color.lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = color.lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = color.lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  const raw = linearToSrgbRgb({
    red: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    green: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    blue: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    alpha,
  });
  const inGamut = (rgb: Rgba): boolean =>
    rgb.red >= -GAMUT_EPSILON && rgb.red <= 1 + GAMUT_EPSILON &&
    rgb.green >= -GAMUT_EPSILON && rgb.green <= 1 + GAMUT_EPSILON &&
    rgb.blue >= -GAMUT_EPSILON && rgb.blue <= 1 + GAMUT_EPSILON;
  if (inGamut(raw)) return clampRgb(raw);

  // Keep the perceptual lightness and hue, reducing chroma only as far as needed
  // to fit the intermediate colour inside the sRGB gamut.
  let low = 0;
  let high = color.chroma;
  let mapped = linearToSrgbRgb({ red: 0, green: 0, blue: 0, alpha });
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const chroma = (low + high) / 2;
    const candidate = oklchToSrgb(color.lightness, chroma, color.hue, alpha);
    if (inGamut(candidate)) {
      low = chroma;
      mapped = candidate;
    } else {
      high = chroma;
    }
  }
  return clampRgb(mapped);
}

function oklchToSrgb(lightness: number, chroma: number, hue: number, alpha: number): Rgba {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return linearToSrgbRgb({
    red: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    green: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    blue: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    alpha,
  });
}

function linearToSrgbRgb(color: Rgba): Rgba {
  return {
    red: linearToSrgb(color.red),
    green: linearToSrgb(color.green),
    blue: linearToSrgb(color.blue),
    alpha: color.alpha,
  };
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function clampRgb(color: Rgba): Rgba {
  return {
    red: Math.min(1, Math.max(0, color.red)),
    green: Math.min(1, Math.max(0, color.green)),
    blue: Math.min(1, Math.max(0, color.blue)),
    alpha: color.alpha,
  };
}

function rgbaToHex(color: Rgba, includeAlpha: boolean): string {
  const channels = [color.red, color.green, color.blue].map((channel) =>
    Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0"));
  if (includeAlpha) channels.push(Math.round(Math.min(1, Math.max(0, color.alpha)) * 255).toString(16).padStart(2, "0"));
  return `#${channels.join("")}`;
}

function shortestHueDelta(from: number, to: number): number {
  const fullTurn = 2 * Math.PI;
  return ((to - from + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
