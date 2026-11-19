/**
 * Click on a line → jump to one of its ends. The first click goes to the end that is nearer
 * along the line to the clicked point; another click on the same line within
 * LINE_JUMP_REPEAT_MS goes to the opposite end of the previous jump (and so on, back and forth).
 */
export const LINE_JUMP_REPEAT_MS = 5_000;

export interface LineJumpMemory {
  linkId: string;
  endId: string;
  at: number;
}

export interface LineJumpInput {
  linkId: string;
  from: string;
  to: string;
  /** Position of the clicked point along the line, 0 = source end, 1 = target end. */
  fraction: number;
  now: number;
  last: LineJumpMemory | null;
}

export function pickLineJumpEnd(input: LineJumpInput): string {
  const { linkId, from, to, fraction, now, last } = input;
  if (last && last.linkId === linkId && now - last.at <= LINE_JUMP_REPEAT_MS &&
    (last.endId === from || last.endId === to)) {
    return last.endId === from ? to : from;
  }
  return fraction <= 0.5 ? from : to;
}

interface MeasurablePath {
  getTotalLength(): number;
  getPointAtLength(length: number): { x: number; y: number };
}

/** Fraction (0..1) along the path of the path point nearest to `point` (both in path coordinates). */
export function nearestFractionOnPath(path: MeasurablePath, point: { x: number; y: number }, samples = 96): number {
  const total = path.getTotalLength();
  if (!(total > 0)) return 0;
  let bestLength = 0;
  let bestDistance = Infinity;
  const consider = (length: number): void => {
    const sample = path.getPointAtLength(length);
    const distance = (sample.x - point.x) ** 2 + (sample.y - point.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestLength = length;
    }
  };
  const step = total / samples;
  for (let index = 0; index <= samples; index += 1) consider(index * step);
  // Refine around the best coarse sample.
  const low = Math.max(0, bestLength - step);
  const high = Math.min(total, bestLength + step);
  for (let index = 0; index <= 16; index += 1) consider(low + ((high - low) * index) / 16);
  return bestLength / total;
}
