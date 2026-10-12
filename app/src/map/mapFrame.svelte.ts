import { board, onBoardMutation } from "../model/board.svelte";
import type { Note } from "../model/note";
import { noteBounds, type Bounds } from "../notes/layout.svelte";
import type { Point } from "../board/cameraMath";
import type { CameraSnapshot } from "./cameraHistory";
import type { MapTransform, WorldRect } from "./mapMath";
import { FrameSnapshotGate } from "./frameSnapshotGate";

export interface MapFrame {
  transform: MapTransform;
  zones: { id: string; color: string; path: string }[];
  notes: Array<WorldRect & { id: string; color: string }>;
  beacons: Array<Point & { id: string; color: string; radius: number }>;
  links: Array<{ id: string; kind: "strong" | "weak"; from: Point; to: Point }>;
  linksSkipped: boolean;
  me: Point | null;
  viewport: WorldRect;
  camera: CameraSnapshot;
  internalZoom: number;
}

export const sharedMapFrame = $state({ value: null as MapFrame | null });

type Builder = () => MapFrame;
const builders = new Set<Builder>();
const noteGeometry = new Map<string, string>();
const frameGate = new FrameSnapshotGate();
let scheduled = false;
let rafHandle: number | null = null;
let geometryDirty = true;

export function mapNoteGeometry(note: Note | undefined): { bounds: Bounds; signature: string } | null {
  if (!note) return null;
  const bounds = noteBounds(note);
  return {
    bounds,
    signature: `${note.type}|${bounds.x}|${bounds.y}|${bounds.width}|${bounds.height}|${note.color ?? ""}`,
  };
}

export function rememberMapNoteGeometry(id: string, signature: string): void {
  noteGeometry.set(id, signature);
}

export function registerMapFrameBuilder(builder: Builder): () => void {
  builders.add(builder);
  invalidateMapGeometry();
  return () => {
    builders.delete(builder);
    if (builders.size === 0 && rafHandle !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
      scheduled = false;
    }
  };
}

export function invalidateMapFrame(): void {
  frameGate.invalidate();
  scheduleBuild();
}

export function invalidateMapGeometry(): void {
  geometryDirty = true;
  invalidateMapFrame();
}

export function mapGeometryNeedsRebuild(): boolean {
  return geometryDirty || sharedMapFrame.value === null;
}

export function markMapGeometryBuilt(): void {
  geometryDirty = false;
}

export function ensureMapFrame(): MapFrame | null {
  buildNow();
  return sharedMapFrame.value;
}

function scheduleBuild(): void {
  if (scheduled || builders.size === 0) return;
  scheduled = true;
  const callback = () => {
    rafHandle = null;
    scheduled = false;
    frameGate.beginFrame();
    buildNow();
  };
  if (typeof requestAnimationFrame === "function") rafHandle = requestAnimationFrame(callback);
  else queueMicrotask(callback);
}

function buildNow(): void {
  if (builders.size === 0 || !frameGate.claimBuild()) return;
  const builder = builders.values().next().value as Builder | undefined;
  if (!builder) { frameGate.buildFailed(); return; }
  try {
    sharedMapFrame.value = builder();
  } catch (error) {
    frameGate.buildFailed();
    throw error;
  }
}

onBoardMutation((ids) => {
  if (ids === null || noteGeometry.size === 0) {
    if (ids === null) noteGeometry.clear();
    invalidateMapGeometry();
    return;
  }
  for (const id of ids) {
    const current = mapNoteGeometry(board.notes[id]);
    const previous = noteGeometry.get(id);
    if (!current) {
      if (previous !== undefined) {
        noteGeometry.delete(id);
        invalidateMapGeometry();
      }
    } else if (current.signature !== previous) {
      noteGeometry.set(id, current.signature);
      invalidateMapGeometry();
    }
  }
});
