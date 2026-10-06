import { PX_PER_UNIT } from "../../board/cameraMath";
import type { BrushSettings } from "../types";
import { levelPxPerUnit } from "../types";
import { rotatedShapeBounds, shapeCenter, shapeSize, traceClosedShape, type ShapeDraft, type ShapeFillMode } from "./shapeGeometry";

export interface RasterizedShape {
  canvas: HTMLCanvasElement;
  rasterX: number;
  rasterY: number;
  level: number;
}

export interface ShapeRasterOptions {
  brush: BrushSettings;
  zoom: number;
  level: number;
  fillMode: ShapeFillMode;
  polygonSides: number;
  cornerRadius: number;
}

const MAX_RASTER_SIDE = 8192;
const MAX_RASTER_PIXELS = 32 * 1024 * 1024;

/** Rasterize one shape into a single antialiased source image for applyAcrossLevels. */
export function rasterizeShape(draft: ShapeDraft, options: ShapeRasterOptions): RasterizedShape {
  const ppu = levelPxPerUnit(options.level);
  const screenScale = PX_PER_UNIT * Math.max(0.05, options.zoom);
  const rasterScale = ppu / screenScale;
  const strokeWidth = Math.max(0.75, options.brush.size * rasterScale);
  const softness = Math.max(0, 1 - options.brush.hardness);
  const blur = strokeWidth * softness * 0.35;
  const padding = (strokeWidth / 2 + blur * 3 + 2) / ppu;
  const bounds = rotatedShapeBounds(draft, padding);
  const rasterX = Math.floor(bounds.left * ppu);
  const rasterY = Math.floor(bounds.top * ppu);
  const width = Math.max(1, Math.ceil(bounds.right * ppu) - rasterX);
  const height = Math.max(1, Math.ceil(bounds.bottom * ppu) - rasterY);
  if (width > MAX_RASTER_SIDE || height > MAX_RASTER_SIDE || width * height > MAX_RASTER_PIXELS) {
    throw new RangeError("This shape is too large to rasterize at the current zoom. Reduce its size and try again.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("The browser could not create a shape raster canvas.");

  const center = shapeCenter(draft);
  const size = shapeSize(draft);
  const radius = Math.min(options.cornerRadius / screenScale * ppu, size.width * ppu / 2, size.height * ppu / 2);
  const color = options.brush.color;
  const opacity = Math.min(1, Math.max(0, options.brush.opacity));
  ctx.translate(center.x * ppu - rasterX, center.y * ppu - rasterY);
  ctx.rotate(draft.rotation);
  ctx.scale(draft.flipX ? -1 : 1, draft.flipY ? -1 : 1);
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;

  const shapeWidth = size.width * ppu;
  const shapeHeight = size.height * ppu;
  const lineLike = draft.kind === "line" || draft.kind === "arrow";
  if (lineLike) {
    const x1 = draft.flipX ? shapeWidth / 2 : -shapeWidth / 2;
    const y1 = draft.flipY ? shapeHeight / 2 : -shapeHeight / 2;
    const x2 = -x1;
    const y2 = -y1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.filter = blur >= 0.5 ? `blur(${blur}px)` : "none";
    ctx.stroke();
    if (draft.kind === "arrow") {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      const headLength = Math.min(length * 0.35, Math.max(strokeWidth * 4, 12 * rasterScale));
      const angle = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
    ctx.filter = "none";
  } else {
    const closed = traceClosedShape(ctx, draft.kind, shapeWidth, shapeHeight, options.polygonSides, radius);
    if (closed && options.fillMode !== "outline") ctx.fill();
    if (closed && options.fillMode !== "fill") {
      ctx.filter = blur >= 0.5 ? `blur(${blur}px)` : "none";
      ctx.stroke();
      ctx.filter = "none";
    }
  }
  return { canvas, rasterX, rasterY, level: options.level };
}
