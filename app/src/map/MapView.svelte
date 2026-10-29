<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Action } from "svelte/action";
  import type { NoteKind } from "../model/note";
  import { board } from "../model/board.svelte";
  import { zones } from "../model/zones.svelte";
  import { ME_POSITION, camera, cameraSettings, refreshPointerWorld, viewport } from "../board/camera.svelte";
  import { zoomAt, type Point } from "../board/cameraMath";
  import { ME_OBJECT_ID } from "../model/link";
  import { hasMeBeacon } from "../beacons/beaconState.svelte";
  import { links as boardLinks } from "../model/links.svelte";
  import { measuredHeights } from "../notes/layout.svelte";
  import { listStatisticsMeasurements } from "../stats/listStatsMeasurements.svelte";
  import { ensureMapFrame, invalidateMapFrame, invalidateMapGeometry, mapGeometryNeedsRebuild, mapNoteGeometry, markMapGeometryBuilt, registerMapFrameBuilder, rememberMapNoteGeometry, sharedMapFrame } from "./mapFrame.svelte";
  import type { MapFrame } from "./mapFrame.svelte";
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
  import { t } from "../i18n/i18n.svelte";
  import { ATTENTION_CELL, attentionPercent, type AttentionSummary } from "../attention/logic";

  const MAP_WIDTH = 400;
  const MAP_HEIGHT = 300;
  const MAP_PADDING = 15;
  const NOTE_TINTS: Record<NoteKind, string> = {
    note: "#d3d7dc", pro: "#8dd6a7", con: "#ed9a93", importance: "#e6c65b",
    purpose: "#85b8e8", mood: "#d5a3db", beacon: "#f0cf62", goal: "#7bd5b4",
    progress: "#73c6d8", calculator: "#bbabef", tierlist: "#e5a875", graph: "#e59ac0", stats: "#9dc778",
    archive: "#baad91", trash: "#d78b82", inbox: "#86c0d4", list: "#9fc982",
    source: "#8ca9dc", glossary: "#d2a5d4", map: "#d7bd70", random: "#e5a469", markas: "#c9a0e8", time: "#7fc4d8", message: "#e8c070", calendar: "#8fc4a0", image: "#9aa6b8", pdf: "#d07a6a", format: "#8fb0c8", audio: "#b39ad6", video: "#c99a5b", youtube: "#d05a5a",
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

  let svg: SVGSVGElement;
  let { variant = "overlay", attention = null }: { variant?: "overlay" | "node"; attention?: AttentionSummary | null } = $props();
  const initialFrame: MapFrame = {
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
  };
  let frame = $derived(sharedMapFrame.value ?? initialFrame);
  const heatFilterId = `map-heat-${Math.random().toString(36).slice(2)}`;
  /** Attention overlay: heat cells where the camera looked, and each zone's share of that time. */
  let heat = $derived.by(() => {
    if (!attention || attention.maxCell <= 0) return [];
    const { transform } = frame;
    const size = ATTENTION_CELL * transform.scale;
    return attention.cells.map((cell) => ({
      ...worldToMap({ x: cell.x, y: cell.y }, transform),
      size,
      key: `${cell.x},${cell.y}`,
      opacity: 0.12 + 0.68 * Math.sqrt(cell.seconds / attention!.maxCell),
    }));
  });

  let zoneShares = $derived.by(() => {
    if (!attention) return [];
    const { transform } = frame;
    return zones.order.flatMap((id) => {
      const zone = zones.byId[id];
      if (!zone || zone.parts.length === 0) return [];
      const points = zone.parts.flat();
      if (points.length === 0) return [];
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const center = worldToMap({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }, transform);
      const name = zone.name.length > 18 ? `${zone.name.slice(0, 17)}…` : zone.name;
      return [{ id, ...center, name, percent: attentionPercent(attention!.zones[id] ?? 0, attention!.total) }];
    });
  });

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

  function captureNotes(): NoteSnapshot[] {
    return board.order.flatMap((id) => {
      const note = board.notes[id];
      if (!note) return [];
      const geometry = mapNoteGeometry(note);
      if (!geometry) return [];
      const bounds = geometry.bounds;
      rememberMapNoteGeometry(note.id, geometry.signature);
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
      links: projectMapLinks(linkSnapshots, notes, transform, hasMeBeacon() ? ME_OBJECT_ID : null, ME_POSITION),
      linksSkipped,
      me: hasMeBeacon() ? worldToMap(ME_POSITION, transform) : null,
      viewport: cameraViewportRect(camera, viewport, transform),
      camera: cameraSnapshot(),
      internalZoom: mapViewState.zoom,
    };
  }

  function currentFrame(): MapFrame {
    const cached = sharedMapFrame.value;
    if (cached && !mapGeometryNeedsRebuild()) {
      return {
        ...cached,
        viewport: cameraViewportRect(camera, viewport, cached.transform),
        camera: cameraSnapshot(),
        internalZoom: mapViewState.zoom,
      };
    }
    const notes = captureNotes();
    const boardZones = captureZones();
    const sourceLinks = Object.values(boardLinks.byId);
    const linksSkipped = sourceLinks.length > MAX_PROJECTED_MAP_LINKS;
    const linkSnapshots: MapLinkInput[] = linksSkipped ? [] : sourceLinks.map(({ id, from, to, kind }) => ({ id, from, to, kind }));
    const mePresent = hasMeBeacon();
    const bounds = wholeBoardBounds(notes, boardZones, mePresent ? ME_POSITION : null);
    const next = makeFrame(notes, boardZones, linkSnapshots, linksSkipped, bounds);
    markMapGeometryBuilt();
    return next;
  }

  $effect(() => {
    return registerMapFrameBuilder(currentFrame);
  });

  $effect(() => {
    void camera.x; void camera.y; void camera.zoom;
    void viewport.width; void viewport.height;
    invalidateMapFrame();
  });

  $effect(() => {
    void mapViewState.zoom;
    invalidateMapGeometry();
  });

  $effect(() => {
    // Subscribe to sparse structural inputs. Note geometry changes arrive through onBoardMutation,
    // so a drag never walks the board from every minimap instance.
    for (const id of board.order) { void measuredHeights[id]; void listStatisticsMeasurements[id]; }
    for (const id of zones.order) {
      const zone = zones.byId[id];
      if (zone) { void zone.color; void zone.parts; void zone.holes; }
    }
    for (const link of Object.values(boardLinks.byId)) {
      void link.from; void link.to; void link.kind;
    }
    void hasMeBeacon();
    invalidateMapGeometry();
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
      const latestFrame = ensureMapFrame() ?? frame;
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
    recordMapCameraChange(before, t("Map navigation"));
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
    if (wheelBefore) recordMapCameraChange(wheelBefore, t("Map zoom"));
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
  aria-label={variant === "overlay" ? t("Board map; click or drag to move the camera, scroll to zoom") : t("Board minimap; click or drag to move the camera, scroll to zoom")}
  data-map-view
  data-map-variant={variant}
  data-map-center-x={frame.camera.x}
  data-map-center-y={frame.camera.y}
  data-map-zoom={frame.camera.zoom}
  data-map-internal-zoom={frame.internalZoom}
  data-map-dragging={mapDragging ? "true" : undefined}
  data-map-link-count={frame.links.length}
  data-map-links-skipped={frame.linksSkipped ? "true" : undefined}
  data-map-attention={attention ? "true" : undefined}
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
      fill-opacity={attention ? "0.12" : "0.24"}
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
      fill-opacity={attention ? "0.3" : "0.88"}
      data-map-note={mark.id}
    />
  {/each}
  {#if heat.length > 0}
    <defs>
      <filter id={heatFilterId} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={Math.max(1, heat[0].size * 0.45)} />
      </filter>
    </defs>
    <g class="map-heat" filter={`url(#${heatFilterId})`}>
      {#each heat as cell (cell.key)}
        <rect x={cell.x} y={cell.y} width={cell.size} height={cell.size} fill="var(--accent)" fill-opacity={cell.opacity} data-map-heat />
      {/each}
    </g>
  {/if}
  {#each zoneShares as share (share.id)}
    <g class="map-zone-share" data-map-zone-share={share.id} transform={`translate(${share.x} ${share.y})`}>
      <text class="map-share-percent" text-anchor="middle" y="0">{share.percent}%</text>
      {#if share.name}<text class="map-share-name" text-anchor="middle" y="10">{share.name}</text>{/if}
    </g>
  {/each}
  {#each frame.beacons as beacon (beacon.id)}
    <circle cx={beacon.x} cy={beacon.y} r={beacon.radius} fill={beacon.color} stroke="#171717" stroke-width="0.7" data-map-beacon={beacon.id} />
  {/each}
  {#if frame.me}
    <circle cx={frame.me.x} cy={frame.me.y} r="3" fill="var(--accent)" stroke="var(--bg-board)" stroke-width="1" data-map-me={ME_OBJECT_ID} />
    <path d={`M${frame.me.x - 5},${frame.me.y}h10M${frame.me.x},${frame.me.y - 5}v10`} stroke="#fff" stroke-opacity="0.75" stroke-width="0.7" vector-effect="non-scaling-stroke" aria-hidden="true" />
  {/if}
  <rect
    class="map-viewport"
    x={frame.viewport.x}
    y={frame.viewport.y}
    width={Math.max(0.5, frame.viewport.width)}
    height={Math.max(0.5, frame.viewport.height)}
    fill="none"
    stroke="var(--accent)"
    stroke-width="2"
    vector-effect="non-scaling-stroke"
    data-map-viewport
  />
</svg>

<style>
  .map-view { display: block; width: 100%; height: 100%; overflow: hidden; background: var(--bg-board); cursor: crosshair; touch-action: none; user-select: none; }
  .map-background { fill: var(--bg-board); }
  .map-viewport, .map-heat, .map-zone-share { pointer-events: none; }
  .map-share-percent { fill: var(--text); font-size: 13px; font-weight: 700; paint-order: stroke; stroke: var(--bg-board); stroke-width: 3px; }
  .map-share-name { fill: var(--text-dim); font-size: 8px; paint-order: stroke; stroke: var(--bg-board); stroke-width: 2.5px; }
</style>
