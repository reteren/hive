/** Minimal selection mask shape shared by drawing operations without importing the rune store. */
export interface SelectionClipMask {
  x: number;
  y: number;
  width: number;
  height: number;
  mask: Uint8Array;
  level: number;
  tool?: string;
}

type SelectionCoverageSampler = (rasterX: number, rasterY: number) => number;
interface SelectionCoverageSamplerVariants {
  direct?: SelectionCoverageSampler;
  integral?: SelectionCoverageSampler;
}

const selectionSamplerCache = new WeakMap<SelectionClipMask, Map<number, SelectionCoverageSamplerVariants>>();

/** Fraction of a raster pixel covered by the selection at the requested pyramid level. */
export function selectionCoverageAtRasterPixel(
  selection: SelectionClipMask,
  rasterX: number,
  rasterY: number,
  level: number,
): number {
  return createSelectionCoverageSampler(selection, level)(rasterX, rasterY);
}

/** Reuse one level-aware mask sampler across a clipped source rectangle. */
export function createSelectionCoverageSampler(
  selection: SelectionClipMask,
  level: number,
  sampleCount = 1,
): SelectionCoverageSampler {
  if (!Number.isFinite(level) || !Number.isFinite(selection.level)) return () => 0;
  const scale = 2 ** (level - selection.level);
  if (!Number.isFinite(scale) || scale <= 0) return () => 0;
  const isRect = selection.tool === "select-rect";
  if (scale <= 1) {
    return (rasterX, rasterY) => {
      if (!Number.isFinite(rasterX) || !Number.isFinite(rasterY)) return 0;
      const localX = Math.floor((rasterX + 0.5) * scale) - selection.x;
      const localY = Math.floor((rasterY + 0.5) * scale) - selection.y;
      if (localX < 0 || localY < 0 || localX >= selection.width || localY >= selection.height) return 0;
      return (selection.mask[localY * selection.width + localX] ?? 0) / 255;
    };
  }

  if (isRect) {
    const pixelArea = scale * scale;
    return (rasterX, rasterY) => {
      if (!Number.isFinite(rasterX) || !Number.isFinite(rasterY)) return 0;
      const left = rasterX * scale;
      const top = rasterY * scale;
      const width = Math.max(0, Math.min(left + scale, selection.x + selection.width) - Math.max(left, selection.x));
      const height = Math.max(0, Math.min(top + scale, selection.y + selection.height) - Math.max(top, selection.y));
      return Math.max(0, Math.min(1, width * height / pixelArea));
    };
  }

  // A small downsample can simply inspect its covered cells. For larger operations, a summed-area
  // table keeps clipping linear in source pixels instead of repeating a large nested mask scan.
  const variants = selectionSamplerCache.get(selection) ?? new Map<number, SelectionCoverageSamplerVariants>();
  selectionSamplerCache.set(selection, variants);
  const cached = variants.get(level) ?? {};
  variants.set(level, cached);
  const useIntegral = sampleCount * scale * scale > selection.width * selection.height * 4;
  const cachedSampler = useIntegral ? cached.integral : cached.direct;
  if (cachedSampler) return cachedSampler;
  if (!useIntegral) {
    const pixelArea = scale * scale;
    const direct: SelectionCoverageSampler = (rasterX, rasterY) => {
      if (!Number.isFinite(rasterX) || !Number.isFinite(rasterY)) return 0;
      const left = rasterX * scale;
      const top = rasterY * scale;
      const right = left + scale;
      const bottom = top + scale;
      let covered = 0;
      for (let y = Math.max(selection.y, Math.floor(top)); y < Math.min(selection.y + selection.height, Math.ceil(bottom)); y += 1) {
        const overlapY = Math.max(0, Math.min(bottom, y + 1) - Math.max(top, y));
        const localY = y - selection.y;
        for (let x = Math.max(selection.x, Math.floor(left)); x < Math.min(selection.x + selection.width, Math.ceil(right)); x += 1) {
          const overlapX = Math.max(0, Math.min(right, x + 1) - Math.max(left, x));
          covered += overlapX * overlapY * ((selection.mask[localY * selection.width + x - selection.x] ?? 0) / 255);
        }
      }
      return Math.max(0, Math.min(1, covered / pixelArea));
    };
    cached.direct = direct;
    return direct;
  }

  const stride = selection.width + 1;
  const integral = new Uint32Array(stride * (selection.height + 1));
  for (let y = 0; y < selection.height; y += 1) {
    let rowTotal = 0;
    for (let x = 0; x < selection.width; x += 1) {
      rowTotal += selection.mask[y * selection.width + x] ?? 0;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + rowTotal;
    }
  }
  const pixelArea = scale * scale;
  const integralSampler: SelectionCoverageSampler = (rasterX, rasterY) => {
    if (!Number.isFinite(rasterX) || !Number.isFinite(rasterY)) return 0;
    const left = Math.max(selection.x, rasterX * scale);
    const top = Math.max(selection.y, rasterY * scale);
    const right = Math.min(selection.x + selection.width, (rasterX + 1) * scale);
    const bottom = Math.min(selection.y + selection.height, (rasterY + 1) * scale);
    if (right <= left || bottom <= top) return 0;
    // Levels are powers of two and all raster origins are integers, so coarse pixel edges align
    // with the mask grid whenever scale > 1.
    const x0 = Math.floor(left) - selection.x;
    const y0 = Math.floor(top) - selection.y;
    const x1 = Math.ceil(right) - selection.x;
    const y1 = Math.ceil(bottom) - selection.y;
    const sum = integral[y1 * stride + x1]! - integral[y0 * stride + x1]! -
      integral[y1 * stride + x0]! + integral[y0 * stride + x0]!;
    return Math.max(0, Math.min(1, sum / 255 / pixelArea));
  };
  cached.integral = integralSampler;
  return integralSampler;
}

/** Clip an RGBA operation source in place; transparent source pixels remain transparent. */
export function clipRasterDataToSelection(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rasterX: number,
  rasterY: number,
  level: number,
  selection: SelectionClipMask,
): void {
  if (data.length !== width * height * 4) throw new RangeError("Selection clipping expects a matching RGBA buffer.");
  const coverageAt = createSelectionCoverageSampler(selection, level, width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const coverage = coverageAt(rasterX + x, rasterY + y);
      const alphaOffset = (y * width + x) * 4 + 3;
      data[alphaOffset] = Math.round((data[alphaOffset] ?? 0) * coverage);
    }
  }
}
