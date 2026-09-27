<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Action } from "svelte/action";
  import type { NoteKind } from "../model/note";
  import { board } from "../model/board.svelte";
  import { zones } from "../model/zones.svelte";
  import { noteBounds } from "../notes/layout.svelte";
  import { ME_POSITION, camera, cameraSettings, refreshPointerWorld, viewport } from "../board/camera.svelte";
  import { zoomAt, type Point } from "../board/cameraMath";
  import { ME_OBJECT_ID } from "../model/link";
  import {
    cameraViewportRect,
    fitMap,
    mapToWorld,
    wholeBoardBounds,
    worldToMap,
    type MapNoteBounds,
    type MapTransform,
    type WorldRect,
  } from "./mapMath";
  import { cameraSnapshot, recordMapCameraChange, restoreCamera, type CameraSnapshot } from "./cameraHistory";

  const MAP_WIDTH = 400;
  const MAP_HEIGHT = 300;
  const MAP_PADDING = 15;
  const NOTE_TINTS: Record<NoteKind, string> = {
    note: "#d3d7dc", pro: "#8dd6a7", con: "#ed9a93", importance: "#e6c65b",
    purpose: "#85b8e8", mood: "#d5a3db", beacon: "#f0cf62", goal: "#7bd5b4",
    progress: "#73c6d8", calculator: "#bbabef", tierlist: "#e5a875", stats: "#9dc778",
    archive: "#baad91", trash: "#d78b82", inbox: "#86c0d4", list: "#9fc982",
    source: "#8ca9dc", glossary: "#d2a5d4", map: "#d7bd70", random: "#e5a469", markas: "#c9a0e8",
  };

  interface ZoneSnapshot {
    id: string;
    color: string;
    parts: { x: number; y: number }[][];
    holes: { x: number; y: number }[][];
  }

  interface NoteSnapshot extends MapNoteBounds {
    type: NoteKind;
    color?: string;
  }

  interface MapRectMark extends WorldRect {
    id: string;
    color: string;
  }

  interface MapDotMark extends Point {
    id: string;
    color: string;
    radius: number;
  }

  interface MapFrame {
    transform: MapTransform;
    zones: { id: string; color: string; path: string }[];
    notes: MapRectMark[];
    beacons: MapDotMark[];
    me: Point;
    viewport: WorldRect;
    camera: CameraSnapshot;
  }

  let svg: SVGSVGElement;
  let { variant = "overlay" }: { variant?: "overlay" | "node" } = $props();
  let frame = $state<MapFrame>({
    transform: fitMap({ x: 0, y: 0, width: 0, height: 0 }, { width: MAP_WIDTH, height: MAP_HEIGHT }, MAP_PADDING),
    zones: [],
    notes: [],
    beacons: [],
    me: worldToMap(ME_POSITION, fitMap({ x: 0, y: 0, width: 0, height: 0 }, { width: MAP_WIDTH, height: MAP_HEIGHT }, MAP_PADDING)),
    viewport: { x: 0, y: 0, width: 0, height: 0 },
    camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
  });
  let cachedBoundsKey = "";
  let cachedBounds: WorldRect = { x: 0, y: 0, width: 0, height: 0 };
  let pendingFrame = 0;
  let dragBefore: CameraSnapshot | null = null;
  let wheelBefore: CameraSnapshot | null = null;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;

  function zonePath(parts: readonly (readonly Point[])[], holes: readonly (readonly Point[])[], transform: MapTransform): string {
    return [...parts, ...holes].map((ring) => {
      if (!ring.length) return "";
      const mapped = ring.map((point) => worldToMap(point, transform));
      return `M${mapped.map((point) => `${point.x},${point.y}`).join("L")}Z`;
    }).join("");
  }

  function geometryKey(notes: readonly NoteSnapshot[], boardZones: readonly ZoneSnapshot[]): string {
    return JSON.stringify([
      notes.map(({ id, x, y, width, height }) => [id, x, y, width, height]),
      boardZones.map(({ id, parts }) => [id, parts]),
    ]);
  }

  function captureNotes(): NoteSnapshot[] {
    return board.order.flatMap((id) => {
      const note = board.notes[id];
      if (!note) return [];
      const bounds = noteBounds(note);
      return [{
        id: note.id,
        type: note.type,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        color: note.color,
      }];
    });
  }

  function captureZones(): ZoneSnapshot[] {
    return zones.order.flatMap((id) => {
      const zone = zones.byId[id];
      if (!zone) return [];
      return [{
        id: zone.id,
        color: zone.color,
        parts: zone.parts.map((part) => part.map((point) => ({ x: point.x, y: point.y }))),
        holes: zone.holes.map((hole) => hole.map((point) => ({ x: point.x, y: point.y }))),
      }];
    });
  }

  function makeFrame(notes: NoteSnapshot[], boardZones: ZoneSnapshot[], bounds: WorldRect): MapFrame {
    const transform = fitMap(bounds, { width: MAP_WIDTH, height: MAP_HEIGHT }, MAP_PADDING);
    const mapNotes: MapRectMark[] = [];
    const beacons: MapDotMark[] = [];

    for (const note of notes) {
      if (note.type === "beacon") {
        const center = worldToMap({ x: note.x + note.width / 2, y: note.y + note.height / 2 }, transform);
        beacons.push({ id: note.id, ...center, color: note.color ?? NOTE_TINTS.beacon, radius: 2.5 });
      } else {
        const topLeft = worldToMap({ x: note.x, y: note.y }, transform);
        mapNotes.push({
          id: note.id,
          ...topLeft,
          width: Math.max(2, note.width * transform.scale),
          height: Math.max(1.4, note.height * transform.scale),
          color: NOTE_TINTS[note.type],
        });
      }
    }

    return {
      transform,
      zones: boardZones.map((zone) => ({
        id: zone.id,
        color: zone.color,
        path: zonePath(zone.parts, zone.holes, transform),
      })),
      notes: mapNotes,
      beacons,
      me: worldToMap(ME_POSITION, transform),
      viewport: cameraViewportRect(camera, viewport, transform),
      camera: cameraSnapshot(),
    };
  }

  $effect(() => {
    const notes = captureNotes();
    const boardZones = captureZones();
    const key = geometryKey(notes, boardZones);
    if (key !== cachedBoundsKey) {
      cachedBounds = wholeBoardBounds(notes, boardZones, ME_POSITION);
      cachedBoundsKey = key;
    }
    const next = makeFrame(notes, boardZones, cachedBounds);
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      frame = next;
      pendingFrame = 0;
    });
  });

  function pointFromEvent(event: PointerEvent): Point | null {
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  }

  function moveCameraToMapPoint(point: Point): void {
    const world = mapToWorld(point, frame.transform);
    camera.x = world.x;
    camera.y = world.y;
    refreshPointerWorld();
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) return;
    finishWheelZoom();
    dragBefore = cameraSnapshot();
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    if (point) moveCameraToMapPoint(point);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragBefore) return;
    const point = pointFromEvent(event);
    if (point) moveCameraToMapPoint(point);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragBefore) return;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    const before = dragBefore;
    dragBefore = null;
    recordMapCameraChange(before, "Map navigation");
  }

  function onPointerCancel(): void {
    if (!dragBefore) return;
    restoreCamera(dragBefore);
    dragBefore = null;
  }

  function finishWheelZoom(): void {
    if (wheelTimer !== undefined) clearTimeout(wheelTimer);
    wheelTimer = undefined;
    if (wheelBefore) recordMapCameraChange(wheelBefore, "Map zoom");
    wheelBefore = null;
  }

  const captureWheel: Action<SVGSVGElement> = (element) => {
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      finishWheelZoomTimerOnly();
      if (!wheelBefore) wheelBefore = cameraSnapshot();
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 300 : 1);
      const zoomed = zoomAt(
        camera,
        viewport,
        { x: viewport.width / 2, y: viewport.height / 2 },
        Math.exp(-delta * cameraSettings.zoomSensitivity),
        cameraSettings,
      );
      camera.x = zoomed.x;
      camera.y = zoomed.y;
      camera.zoom = zoomed.zoom;
      refreshPointerWorld();
      wheelTimer = setTimeout(finishWheelZoom, 240);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return { destroy: () => element.removeEventListener("wheel", onWheel) };
  };

  function finishWheelZoomTimerOnly(): void {
    if (wheelTimer !== undefined) clearTimeout(wheelTimer);
    wheelTimer = undefined;
  }

  onDestroy(() => {
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    if (dragBefore) restoreCamera(dragBefore);
    finishWheelZoom();
  });
</script>

<svg
  bind:this={svg}
  class="map-view"
  viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
  preserveAspectRatio="xMidYMid meet"
  role="img"
  aria-label={variant === "overlay" ? "Board map; click or drag to move the camera, scroll to zoom" : "Board minimap; click or drag to move the camera, scroll to zoom"}
  data-map-view
  data-map-variant={variant}
  data-map-center-x={frame.camera.x}
  data-map-center-y={frame.camera.y}
  data-map-zoom={frame.camera.zoom}
  use:captureWheel
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
>
  <rect class="map-background" x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} />
  {#each frame.zones as zone (zone.id)}
    <path
      d={zone.path}
      fill={zone.color}
      fill-opacity="0.24"
      fill-rule="evenodd"
      stroke={zone.color}
      stroke-opacity="0.75"
      stroke-width="1.2"
      vector-effect="non-scaling-stroke"
      data-map-zone={zone.id}
    />
  {/each}
  {#each frame.notes as mark (mark.id)}
    <rect
      x={mark.x}
      y={mark.y}
      width={mark.width}
      height={mark.height}
      rx="0.8"
      fill={mark.color}
      fill-opacity="0.88"
      data-map-note={mark.id}
    />
  {/each}
  {#each frame.beacons as beacon (beacon.id)}
    <circle cx={beacon.x} cy={beacon.y} r={beacon.radius} fill={beacon.color} stroke="#171717" stroke-width="0.7" data-map-beacon={beacon.id} />
  {/each}
  <circle cx={frame.me.x} cy={frame.me.y} r="3" fill="#f4f4ef" stroke="#181818" stroke-width="1" data-map-me={ME_OBJECT_ID} />
  <path d={`M${frame.me.x - 5},${frame.me.y}h10M${frame.me.x},${frame.me.y - 5}v10`} stroke="#fff" stroke-opacity="0.75" stroke-width="0.7" vector-effect="non-scaling-stroke" aria-hidden="true" />
  <rect
    class="map-viewport"
    x={frame.viewport.x}
    y={frame.viewport.y}
    width={Math.max(0.5, frame.viewport.width)}
    height={Math.max(0.5, frame.viewport.height)}
    fill="none"
    stroke="#fff4ae"
    stroke-width="2"
    vector-effect="non-scaling-stroke"
    data-map-viewport
  />
</svg>

<style>
  .map-view { display: block; width: 100%; height: 100%; overflow: hidden; background: #191c1c; cursor: crosshair; touch-action: none; user-select: none; }
  .map-background { fill: #191c1c; }
  .map-viewport { pointer-events: none; }
</style>
