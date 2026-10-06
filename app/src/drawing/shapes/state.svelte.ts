import type { ShapeDraft, ShapeFillMode, ShapeKind } from "./shapeGeometry";

export const shapeSettings = $state({
  kind: "line" as ShapeKind,
  fillMode: "outline" as ShapeFillMode,
  polygonSides: 5,
  cornerRadius: 16,
});

/** Replaced as a whole; handlers never compare draft objects by identity. */
export const shapeUi = $state({ draft: null as ShapeDraft | null, error: "", committing: false });

export function setShapeKind(kind: ShapeKind): void {
  shapeSettings.kind = kind;
}

export function setShapeFillMode(fillMode: ShapeFillMode): void {
  shapeSettings.fillMode = fillMode;
}

export function setPolygonSides(value: number): void {
  shapeSettings.polygonSides = Math.min(12, Math.max(3, Math.round(Number.isFinite(value) ? value : 5)));
}

export function setCornerRadius(value: number): void {
  shapeSettings.cornerRadius = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}
