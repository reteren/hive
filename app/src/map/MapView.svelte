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
  import { links as boardLinks } from "../model/links.svelte";
  import {
    cameraViewportRect,
    clientToMapPoint,
    mapDragThresholdExceeded,
    MAX_PROJECTED_MAP_LINKS,
    mapTransformForBounds,
    mapToWorld,
    projectMapLinks,
    wholeBoardBounds,
    worldToMap,
    type MapNoteBounds,
    type MapLinkInput,
    type MapTransform,
    type ClientToMapMatrix,
    type WorldRect,
  } from "./mapMath";
  import { cameraSnapshot, recordMapCameraChange, recordMapInternalZoomChange, restoreCamera, type CameraSnapshot } from "./cameraHistory";
  import { mapViewState, setMapInternalZoom } from "./mapViewState.svelte";

  const MAP_WIDTH = 400;
  const MAP_HEIGHT = 300;
  const MAP_PADDING = 15;
  const NOTE_TINTS: Record<NoteKind, string> = {
    note: "#d3d7dc", pro: "#8dd6a7", con: "#ed9a93", importance: "#e6c65b",
    purpose: "#85b8e8", mood: "#d5a3db", beacon: "#f0cf62", goal: "#7bd5b4",
    progress: "#73c6d8", calculator: "#bbabef", tierlist: "#e5a875", stats: "#9dc778",
    archive: "#baad91", trash: "#d78b82", inbox: "#86c0d4", list: "#9fc982",
    source: "#8ca9dc", glossary: "#d2a5d4", map: "#d7bd70", random: "#e5a469", markas: "#c9a0e8", time: "#7fc4d8", message: "#e8c070",
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
    links: { id: string; kind: "strong" | "weak"; from: Point; to: Point }[];
    linksSkipped: boolean;
    me: Point;
    viewport: WorldRect;
    camera: CameraSnapshot;
    internalZoom: number;
  }

  let svg: SVGSVGElement;
  let { variant = "overlay" }: { variant?: "overlay" | "node" } = $props();
  let frame = $state<MapFrame>({
    transform: mapTransformForBounds({ x: 0, y: 0, width: 0, height: 0 }, { width: MAP_WIDTH, height: MAP_HEIGHT }, MAP_PADDING, mapViewState.zoom),
    zones: [],
    notes: [],
    beacons: [],
    links: [],
    linksSkipped: false,
    me: worldToMap(ME_POSITION, mapTransformForBounds({ x: 0, y: 0, width: 0, height: 0 }, { width: MAP_WIDTH, height: MAP_HEIGHT }, MAP_PADDING, mapViewState.zoom)),
    viewport: { x: 0, y: 0, width: 0, height: 0 },
    camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
    internalZoom: mapViewState.zoom,
  });
  let cachedBoundsKey = "";
  let cachedBounds: WorldRect = { x: 0, y: 0, width: 0, height: 0 };
  let dragBefore: CameraSnapshot | null = null;
  let dragStartClient: Point | null = null;
  let dragScreenToMap: ClientToMapMatrix | null = null;
  let mapDragging = $state(false);
  let wheelBefore: CameraSnapshot | null = null;
  let internalWheelBefore: number | null = null;
  let cameraWheelTimer: ReturnType<typeof setTimeout> | undefined;
  let internalWheelTimer: ReturnType<typeof setTimeout> | undefined;

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

  function makeFrame(
    notes: NoteSnapshot[],
    boardZones: ZoneSnapshot[],
    linkSnapshots: MapLinkInput[],
    linksSkipped: boolean,
    bounds: WorldRect,
  ): MapFrame {
    const box = { width: MAP_WIDTH, height: MAP_HEIGHT };
    const transform = mapTransformForBounds(bounds, box, MAP_PADDING, mapViewState.zoom);
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
      links: projectMapLinks(linkSnapshots, notes, transform, ME_OBJECT_ID, ME_POSITION),
      linksSkipped,
      me: worldToMap(ME_POSITION, transform),
      viewport: cameraViewportRect(camera, viewport, transform),
      camera: cameraSnapshot(),
      internalZoom: mapViewState.zoom,
    };
  }

  function currentFrame(): MapFrame {
    const notes = captureNotes();
    const boardZones = captureZones();
    const sourceLinks = Object.values(boardLinks.byId);
    const linksSkipped = sourceLinks.length > MAX_PROJECTED_MAP_LINKS;
    const linkSnapshots: MapLinkInput[] = linksSkipped ? [] : sourceLinks.map(({ id, from, to, kind }) => ({ id, from, to, kind }));
    const key = geometryKey(notes, boardZones);
    if (key !== cachedBoundsKey) {
      cachedBounds = wholeBoardBounds(notes, boardZones, ME_POSITION);
      cachedBoundsKey = key;
    }
    return makeFrame(notes, boardZones, linkSnapshots, linksSkipped, cachedBounds);
  }

  $effect(() => {
    // Keep geometry and its click transform in the same render. A queued animation-frame
    // assignment let the first pointer event use the initial empty-board transform.
    frame = currentFrame();
  });

  function screenToMapMatrix(): ClientToMapMatrix | null {
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const inverse = matrix.inverse();
    return { a: inverse.a, b: inverse.b, c: inverse.c, d: inverse.d, e: inverse.e, f: inverse.f };
  }

  function pointFromEvent(event: PointerEvent, capturedMatrix?: ClientToMapMatrix | null): Point | null {
    const matrix = capturedMatrix === undefined ? screenToMapMatrix() : capturedMatrix;
    return matrix ? clientToMapPoint({ x: event.clientX, y: event.clientY }, matrix) : null;
  }

  function moveCameraToMapPoint(point: Point, transform: MapTransform = frame.transform): void {
    const world = mapToWorld(point, transform);
    camera.x = world.x;
    camera.y = world.y;
    refreshPointerWorld();
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) return;
    finishCameraWheelZoom();
    finishInternalWheelZoom();
    dragBefore = cameraSnapshot();
    dragStartClient = { x: event.clientX, y: event.clientY };
    dragScreenToMap = screenToMapMatrix();
    mapDragging = false;
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event, dragScreenToMap);
    if (point) {
      const latestFrame = currentFrame();
      frame = latestFrame;
      moveCameraToMapPoint(point, latestFrame.transform);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragBefore || !dragStartClient || !dragScreenToMap) return;
    if (!mapDragging && !mapDragThresholdExceeded(dragStartClient, { x: event.clientX, y: event.clientY })) return;
    mapDragging = true;
    const point = pointFromEvent(event, dragScreenToMap);
    if (point) moveCameraToMapPoint(point);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragBefore) return;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    const before = dragBefore;
    dragBefore = null;
    dragStartClient = null;
    dragScreenToMap = null;
    mapDragging = false;
    recordMapCameraChange(before, "Map navigation");
  }

  function onPointerCancel(): void {
    if (!dragBefore) return;
    restoreCamera(dragBefore);
    dragBefore = null;
    dragStartClient = null;
    dragScreenToMap = null;
    mapDragging = false;
  }

  function finishCameraWheelZoom(): void {
    if (cameraWheelTimer !== undefined) clearTimeout(cameraWheelTimer);
    cameraWheelTimer = undefined;
    if (wheelBefore) recordMapCameraChange(wheelBefore, "Map zoom");
    wheelBefore = null;
  }

  function finishInternalWheelZoom(): void {
    if (internalWheelTimer !== undefined) clearTimeout(internalWheelTimer);
    internalWheelTimer = undefined;
    if (internalWheelBefore !== null) {
      setMapInternalZoom(mapViewState.zoom);
      recordMapInternalZoomChange(internalWheelBefore, mapViewState.zoom);
    }
    internalWheelBefore = null;
  }

  const captureWheel: Action<SVGSVGElement> = (element) => {
    const onWheel = (event: WheelEvent): void => {
      if (variant === "node" && !event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 300 : 1;
      const delta = Math.max(-2000, Math.min(2000, event.deltaY * scale));
      if (event.ctrlKey) {
        finishCameraWheelZoom();
        if (internalWheelTimer !== undefined) clearTimeout(internalWheelTimer);
        if (internalWheelBefore === null) internalWheelBefore = mapViewState.zoom;
        setMapInternalZoom(mapViewState.zoom * Math.exp(-delta * cameraSettings.zoomSensitivity), false);
        internalWheelTimer = setTimeout(finishInternalWheelZoom, 240);
        return;
      }
      finishInternalWheelZoom();
      if (cameraWheelTimer !== undefined) clearTimeout(cameraWheelTimer);
      if (!wheelBefore) wheelBefore = cameraSnapshot();
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
      cameraWheelTimer = setTimeout(finishCameraWheelZoom, 240);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return { destroy: () => element.removeEventListener("wheel", onWheel) };
  };

  onDestroy(() => {
    if (dragBefore) restoreCamera(dragBefore);
    dragBefore = null;
    dragStartClient = null;
    dragScreenToMap = null;
    mapDragging = false;
    finishCameraWheelZoom();
    finishInternalWheelZoom();
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
  data-map-internal-zoom={frame.internalZoom}
  data-map-dragging={mapDragging ? "true" : undefined}
  data-map-link-count={frame.links.length}
  data-map-links-skipped={frame.linksSkipped ? "true" : undefined}
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
  {#each frame.links as link (link.id)}
    <line
      x1={link.from.x}
      y1={link.from.y}
      x2={link.to.x}
      y2={link.to.y}
      stroke={link.kind === "strong" ? "#b6b8ad" : "#929c9b"}
      stroke-opacity={link.kind === "strong" ? "0.42" : "0.32"}
      stroke-width="0.75"
      stroke-dasharray={link.kind === "weak" ? "3 3" : undefined}
      vector-effect="non-scaling-stroke"
      data-map-link={link.id}
      data-map-link-kind={link.kind}
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
