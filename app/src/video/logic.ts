export interface VideoNodeSize {
  width: number;
  height: number;
}

/** Fit a video's natural dimensions so its longest side occupies 48 board units. */
export function fitVideoSize(naturalWidth: number | undefined, naturalHeight: number | undefined, maxSide = 48): VideoNodeSize {
  const sourceWidth = validDimension(naturalWidth) ? naturalWidth : 16;
  const sourceHeight = validDimension(naturalHeight) ? naturalHeight : 9;
  const safeMaxSide = Number.isFinite(maxSide) && maxSide > 0 ? maxSide : 48;
  const scale = safeMaxSide / Math.max(sourceWidth, sourceHeight);
  return { width: sourceWidth * scale, height: sourceHeight * scale };
}

function validDimension(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
