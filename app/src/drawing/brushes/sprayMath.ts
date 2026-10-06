import type { StrokePoint } from "../brush";

/** Xorshift32 generator; the stroke owns one instance so dot placement is repeatable. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/** Dots/sec per density unit at the 24 px reference diameter (density 120 → 480 dots/s). */
export const SPRAY_DOTS_PER_DENSITY = 4;
/** Upper bound for the output rate so huge, dense sprays stay cheap (~50 dots per 60 Hz frame). */
export const SPRAY_MAX_RATE = 3000;

/**
 * Dots/sec, scaled by brush area and pressure. A mouse reports the neutral 0.5 and sprays at the
 * full rate; a pen goes from nothing (no pressure) to double density (full pressure).
 */
export function sprayRate(density: number, brushSize: number, pressure: number): number {
  const safeDensity = Number.isFinite(density) ? Math.max(1, Math.min(200, density)) : 120;
  const safeSize = Number.isFinite(brushSize) ? Math.max(1, Math.min(400, brushSize)) : 10;
  const pressureScale = Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) * 2 : 1;
  return Math.min(SPRAY_MAX_RATE, safeDensity * SPRAY_DOTS_PER_DENSITY * (safeSize / 24) ** 2 * pressureScale);
}

/** Uniformly distributed dot centers that keep the whole dot inside the screen-space brush circle. */
export function randomSprayDabs(
  center: StrokePoint,
  brushSize: number,
  dotSize: number,
  count: number,
  random: () => number,
): StrokePoint[] {
  const radius = Math.max(0, (Math.max(1, brushSize) - Math.max(1, dotSize)) / 2);
  const points: StrokePoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const distance = Math.sqrt(random()) * radius;
    const angle = random() * Math.PI * 2;
    points.push({ x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance });
  }
  return points;
}

export function newSpraySeed(): number {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
  }
  return Math.floor(Math.random() * 0xffff_ffff) || 1;
}
