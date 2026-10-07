export type ShapeKind = "line" | "arrow" | "rectangle" | "rounded-rectangle" | "ellipse" | "triangle" | "star" | "polygon";
export type ShapeFillMode = "outline" | "fill" | "outline-fill";

export interface ShapeDraft {
  kind: ShapeKind;
  /** Unrotated rectangle in world units. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export interface ShapePoint { x: number; y: number }
export interface ShapeBounds { left: number; top: number; right: number; bottom: number }

export function clampPolygonSides(value: number): number {
  return Math.min(12, Math.max(3, Math.round(Number.isFinite(value) ? value : 5)));
}

/** Build the initial shape rectangle, applying centre-origin and proportional modifiers. */
export function shapeDraftFromDrag(
  kind: ShapeKind,
  start: ShapePoint,
  current: ShapePoint,
  modifiers: { shift: boolean; alt: boolean },
): ShapeDraft {
  if (isLineShape(kind)) {
    // Lines run from the press to the pointer; Alt mirrors the start around the press point.
    const end = modifiers.shift ? snapLineEnd(start, current) : current;
    const from = modifiers.alt ? { x: 2 * start.x - end.x, y: 2 * start.y - end.y } : start;
    return lineDraft(kind, from, end);
  }
  let dx = current.x - start.x;
  let dy = current.y - start.y;
  if (modifiers.shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }

  const end = { x: start.x + dx, y: start.y + dy };
  const left = modifiers.alt ? start.x - Math.abs(dx) : Math.min(start.x, end.x);
  const right = modifiers.alt ? start.x + Math.abs(dx) : Math.max(start.x, end.x);
  const top = modifiers.alt ? start.y - Math.abs(dy) : Math.min(start.y, end.y);
  const bottom = modifiers.alt ? start.y + Math.abs(dy) : Math.max(start.y, end.y);
  return {
    kind,
    left,
    top,
    right,
    bottom,
    rotation: 0,
    flipX: dx < 0,
    flipY: dy < 0,
  };
}

export function isLineShape(kind: ShapeKind): boolean {
  return kind === "line" || kind === "arrow";
}

/** Snap `point` around `anchor` to 15° steps (Shift for lines and arrows). */
export function snapLineEnd(anchor: ShapePoint, point: ShapePoint): ShapePoint {
  const length = Math.hypot(point.x - anchor.x, point.y - anchor.y);
  const angle = Math.round(Math.atan2(point.y - anchor.y, point.x - anchor.x) / (Math.PI / 12)) * (Math.PI / 12);
  return { x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length };
}

/** A line/arrow draft that runs from `start` to `end` (the arrow head sits at `end`). */
export function lineDraft(kind: ShapeKind, start: ShapePoint, end: ShapePoint): ShapeDraft {
  return {
    kind,
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
    rotation: 0,
    flipX: end.x < start.x,
    flipY: end.y < start.y,
  };
}

/** World start and end of a line/arrow draft. */
export function lineEndpoints(draft: ShapeDraft): { start: ShapePoint; end: ShapePoint } {
  const center = shapeCenter(draft);
  const halfX = (draft.right - draft.left) / 2 * (draft.flipX ? -1 : 1);
  const halfY = (draft.bottom - draft.top) / 2 * (draft.flipY ? -1 : 1);
  return {
    start: rotatePoint({ x: center.x - halfX, y: center.y - halfY }, center, draft.rotation),
    end: rotatePoint({ x: center.x + halfX, y: center.y + halfY }, center, draft.rotation),
  };
}

/** Line endpoints in the local frame used by the renderers (origin = centre, before the flip scale). */
export function localLineEnds(width: number, height: number): { x1: number; y1: number; x2: number; y2: number } {
  // The canvas is already mirrored by the draft's flips, so the unflipped diagonal lands on the
  // real start → end direction (flipping here as well drew lines dragged left-down mirrored).
  return { x1: -width / 2, y1: -height / 2, x2: width / 2, y2: height / 2 };
}

export function shapeCenter(draft: ShapeDraft): ShapePoint {
  return { x: (draft.left + draft.right) / 2, y: (draft.top + draft.bottom) / 2 };
}

export function shapeSize(draft: ShapeDraft): { width: number; height: number } {
  return { width: Math.max(0, draft.right - draft.left), height: Math.max(0, draft.bottom - draft.top) };
}

export function rotatePoint(point: ShapePoint, center: ShapePoint, radians: number): ShapePoint {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine };
}

export function shapeFrameCorners(draft: ShapeDraft, minimumExtent = 0): ShapePoint[] {
  const center = shapeCenter(draft);
  const halfWidth = Math.max((draft.right - draft.left) / 2, minimumExtent / 2);
  const halfHeight = Math.max((draft.bottom - draft.top) / 2, minimumExtent / 2);
  return [
    { x: center.x - halfWidth, y: center.y - halfHeight },
    { x: center.x, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y },
    { x: center.x + halfWidth, y: center.y + halfHeight },
    { x: center.x, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y },
  ].map((point) => rotatePoint(point, center, draft.rotation));
}

export function rotatedShapeBounds(draft: ShapeDraft, padding = 0): ShapeBounds {
  const center = shapeCenter(draft);
  const halfWidth = (draft.right - draft.left) / 2;
  const halfHeight = (draft.bottom - draft.top) / 2;
  const cosine = Math.abs(Math.cos(draft.rotation));
  const sine = Math.abs(Math.sin(draft.rotation));
  const extentX = halfWidth * cosine + halfHeight * sine + padding;
  const extentY = halfWidth * sine + halfHeight * cosine + padding;
  return { left: center.x - extentX, top: center.y - extentY, right: center.x + extentX, bottom: center.y + extentY };
}

export function worldToLocal(point: ShapePoint, draft: ShapeDraft): ShapePoint {
  const center = shapeCenter(draft);
  return rotatePoint(point, center, -draft.rotation);
}

/** Apply a move or one of the eight resize handles in the shape's local axes. */
export function editShapeDraft(
  draft: ShapeDraft,
  localPointer: ShapePoint,
  action: { kind: "move" } | { kind: "resize"; handle: number },
  startDraft: ShapeDraft,
  startLocalPointer: ShapePoint,
): ShapeDraft {
  const dx = localPointer.x - startLocalPointer.x;
  const dy = localPointer.y - startLocalPointer.y;
  if (action.kind === "move") {
    return { ...startDraft, left: startDraft.left + dx, right: startDraft.right + dx, top: startDraft.top + dy, bottom: startDraft.bottom + dy };
  }
  const start = { ...startDraft };
  let left = start.left;
  let right = start.right;
  let top = start.top;
  let bottom = start.bottom;
  let flipX = start.flipX;
  let flipY = start.flipY;
  const movesLeft = action.handle === 0 || action.handle === 6 || action.handle === 7;
  const movesRight = action.handle === 2 || action.handle === 3 || action.handle === 4;
  const movesTop = action.handle === 0 || action.handle === 1 || action.handle === 2;
  const movesBottom = action.handle === 4 || action.handle === 5 || action.handle === 6;
  const minimum = 0.25;

  if (movesLeft) {
    const moved = start.left + dx;
    if (moved <= start.right) {
      left = Math.min(moved, start.right - minimum);
      right = start.right;
    } else {
      left = start.right;
      right = moved;
      flipX = !start.flipX;
    }
  } else if (movesRight) {
    const moved = start.right + dx;
    if (moved >= start.left) {
      left = start.left;
      right = Math.max(moved, start.left + minimum);
    } else {
      left = moved;
      right = start.left;
      flipX = !start.flipX;
    }
  }
  if (movesTop) {
    const moved = start.top + dy;
    if (moved <= start.bottom) {
      top = Math.min(moved, start.bottom - minimum);
      bottom = start.bottom;
    } else {
      top = start.bottom;
      bottom = moved;
      flipY = !start.flipY;
    }
  } else if (movesBottom) {
    const moved = start.bottom + dy;
    if (moved >= start.top) {
      top = start.top;
      bottom = Math.max(moved, start.top + minimum);
    } else {
      top = moved;
      bottom = start.top;
      flipY = !start.flipY;
    }
  }
  const adjusted = { ...start, left, top, right, bottom, flipX, flipY };
  if (![left, top, right, bottom].every(Number.isFinite)) return start;
  return adjusted;
}

export function traceClosedShape(
  ctx: Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo" | "closePath" | "ellipse" | "quadraticCurveTo" | "roundRect">,
  kind: ShapeKind,
  width: number,
  height: number,
  sides: number,
  cornerRadius: number,
): boolean {
  if (kind === "line" || kind === "arrow") return false;
  const halfW = width / 2;
  const halfH = height / 2;
  ctx.beginPath();
  if (kind === "ellipse") {
    ctx.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2);
    ctx.closePath();
    return true;
  }
  if (kind === "rounded-rectangle") {
    const radius = Math.min(Math.max(0, cornerRadius), halfW, halfH);
    if (typeof ctx.roundRect === "function") ctx.roundRect(-halfW, -halfH, width, height, radius);
    else {
      ctx.moveTo(-halfW + radius, -halfH);
      ctx.lineTo(halfW - radius, -halfH);
      ctx.quadraticCurveTo(halfW, -halfH, halfW, -halfH + radius);
      ctx.lineTo(halfW, halfH - radius);
      ctx.quadraticCurveTo(halfW, halfH, halfW - radius, halfH);
      ctx.lineTo(-halfW + radius, halfH);
      ctx.quadraticCurveTo(-halfW, halfH, -halfW, halfH - radius);
      ctx.lineTo(-halfW, -halfH + radius);
      ctx.quadraticCurveTo(-halfW, -halfH, -halfW + radius, -halfH);
    }
    ctx.closePath();
    return true;
  }
  if (kind === "rectangle") {
    ctx.moveTo(-halfW, -halfH);
    ctx.lineTo(halfW, -halfH);
    ctx.lineTo(halfW, halfH);
    ctx.lineTo(-halfW, halfH);
    ctx.closePath();
    return true;
  }
  const count = kind === "triangle" ? 3 : kind === "star" ? 10 : clampPolygonSides(sides);
  for (let index = 0; index < count; index += 1) {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const starScale = kind === "star" && index % 2 === 1 ? 0.42 : 1;
    const point = { x: Math.cos(angle) * halfW * starScale, y: Math.sin(angle) * halfH * starScale };
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  return true;
}
