<script lang="ts">
  import { onMount } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld, type Point } from "../board/cameraMath";
  import { grid } from "../board/grid.svelte";
  import { history } from "../history/history.svelte";
  import { zones } from "../model/zones.svelte";
  import type { ZoneBounds } from "../model/zone";
  import { shapeBounds, shapeContainsPoint, MIN_ZONE_PART, type ZoneShape } from "./shape";
  import {
    dragSegment,
    dragVertex,
    hitEdge,
    hitVertex,
    insertCut,
    scaleByVertex,
    type EditContour,
    type EdgeHit,
    type VertexRef,
  } from "./contourEdit";
  import {
    commitContourEdit,
    cutOutShapeEditArea,
    leaveShapeEdit,
    shapeEdit,
  } from "./shapeEdit.svelte";
  import { isTextEditingTarget } from "../commands/focus";
  import { tool } from "../tools/tool.svelte";

  type GestureBase = {
    pointerId: number;
    startWorld: Point;
    startScreen: Point;
    base: EditContour;
    moved: boolean;
  };
  type Gesture =
    | (GestureBase & { kind: "edge"; hit: EdgeHit })
    | (GestureBase & { kind: "segment"; hit: EdgeHit })
    | (GestureBase & { kind: "vertex"; hit: VertexRef; scale: boolean })
    | (GestureBase & { kind: "marquee" });

  const HIT_RADIUS_PX = 8;
  const START_MARGIN_PX = 18;
  const MOVE_THRESHOLD_PX = 4;
  const VERTEX_SIZE_PX = 8;
  let boardElement: HTMLDivElement | null = null;
  let gesture = $state<Gesture | null>(null);
  let hoverEdge = $state<EdgeHit | null>(null);

  const transform = $derived(
    `translate(${viewport.width / 2} ${viewport.height / 2}) scale(${camera.zoom * PX_PER_UNIT}) translate(${-camera.x} ${-camera.y})`,
  );
  const activeZone = $derived(shapeEdit.zoneId ? zones.byId[shapeEdit.zoneId] ?? null : null);
  const markerSize = $derived(VERTEX_SIZE_PX / Math.max(PX_PER_UNIT * camera.zoom, 0.001));

  function ringPoints(points: readonly Point[]): string {
    return points.map((point) => `${point.x},${point.y}`).join(" ");
  }

  function localPoint(event: Pick<PointerEvent, "clientX" | "clientY">): Point {
    const rect = boardElement!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function worldPoint(event: Pick<PointerEvent, "clientX" | "clientY">): Point {
    return screenToWorld(camera, viewport, localPoint(event));
  }

  function editOptions() {
    const editedId = shapeEdit.zoneId;
    const obstacles = Object.values(zones.byId)
      .filter((zone) => zone.id !== editedId)
      .map((zone): ZoneShape => ({ parts: zone.parts, holes: zone.holes }));
    return {
      minPart: MIN_ZONE_PART,
      obstacles,
      ...(grid.snap ? { snapStep: grid.step } : {}),
    };
  }

  function pointerDown(event: PointerEvent): void {
    const id = shapeEdit.zoneId;
    const zone = id ? zones.byId[id] : undefined;
    const contour = shapeEdit.contour;
    if (!zone || !id || !contour) return;

    if (event.button === 2) {
      gesture = null;
      leaveShapeEdit();
      return;
    }
    if (event.button !== 0 || isTextEditingTarget(event.target)) return;

    const screen = localPoint(event);
    const world = screenToWorld(camera, viewport, screen);
    const tolerance = HIT_RADIUS_PX / Math.max(PX_PER_UNIT * camera.zoom, 0.001);
    const vertex = hitVertex(contour, world, tolerance);
    const edge = vertex ? null : hitEdge(contour, world, tolerance, grid.snap ? grid.step : undefined);
    const base = cloneContour(contour);

    event.preventDefault();
    event.stopImmediatePropagation();
    shapeEdit.marquee = null;
    hoverEdge = null;

    if (vertex) {
      gesture = {
        kind: "vertex",
        pointerId: event.pointerId,
        startWorld: world,
        startScreen: screen,
        base,
        moved: false,
        hit: vertex,
        scale: event.ctrlKey,
      };
      capture(event.pointerId);
      return;
    }
    if (edge) {
      gesture = {
        kind: "edge",
        pointerId: event.pointerId,
        startWorld: world,
        startScreen: screen,
        base,
        moved: false,
        hit: edge,
      };
      capture(event.pointerId);
      return;
    }

    const pointOnOtherZone = Object.values(zones.byId).some((other) =>
      other.id !== id && shapeContainsPoint(other, world));
    if (pointOnOtherZone || !nearZoneBounds(world, shapeBounds(zone), START_MARGIN_PX / Math.max(PX_PER_UNIT * camera.zoom, 0.001))) {
      gesture = null;
      leaveShapeEdit();
      return;
    }

    gesture = {
      kind: "marquee",
      pointerId: event.pointerId,
      startWorld: world,
      startScreen: screen,
      base,
      moved: false,
    };
    capture(event.pointerId);
  }

  function pointerMove(event: PointerEvent): void {
    const activeGesture = gesture;
    if (!activeGesture || activeGesture.pointerId !== event.pointerId || !shapeEdit.zoneId) {
      if (!shapeEdit.zoneId || !shapeEdit.contour) return;
      const world = worldPoint(event);
      const tolerance = HIT_RADIUS_PX / Math.max(PX_PER_UNIT * camera.zoom, 0.001);
      hoverEdge = hitVertex(shapeEdit.contour, world, tolerance)
        ? null
        : hitEdge(shapeEdit.contour, world, tolerance, grid.snap ? grid.step : undefined);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    updatePreview(activeGesture, event);
  }

  function updatePreview(activeGesture: Gesture, event: PointerEvent): void {
    const screen = localPoint(event);
    const world = screenToWorld(camera, viewport, screen);
    const crossed = distanceSquared(screen, activeGesture.startScreen) >= MOVE_THRESHOLD_PX ** 2;

    if (activeGesture.kind === "edge") {
      if (!crossed) return;
      const segment: Extract<Gesture, { kind: "segment" }> = { ...activeGesture, kind: "segment", moved: true };
      gesture = segment;
      applySegmentPreview(segment, world);
      return;
    }
    if (!crossed && !activeGesture.moved) return;

    activeGesture.moved = true;
    if (activeGesture.kind === "marquee") {
      shapeEdit.marquee = rectBetween(activeGesture.startWorld, world);
      return;
    }
    if (activeGesture.kind === "segment") {
      applySegmentPreview(activeGesture, world);
      return;
    }

    const delta = { x: world.x - activeGesture.startWorld.x, y: world.y - activeGesture.startWorld.y };
    shapeEdit.contour = activeGesture.scale
      ? scaleByVertex(activeGesture.base, activeGesture.hit, delta, editOptions())
      : dragVertex(activeGesture.base, activeGesture.hit, delta, editOptions());
  }

  function applySegmentPreview(activeGesture: Extract<Gesture, { kind: "segment" }>, world: Point): void {
    const delta = { x: world.x - activeGesture.startWorld.x, y: world.y - activeGesture.startWorld.y };
    shapeEdit.contour = dragSegment(activeGesture.base, activeGesture.hit, delta, editOptions());
  }

  function pointerUp(event: PointerEvent): void {
    const activeGesture = gesture;
    if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    updatePreview(activeGesture, event);
    const completed = gesture;
    gesture = null;
    release(event.pointerId);
    if (!completed || !shapeEdit.contour) return;

    if (completed.kind === "edge" && !completed.moved) {
      const after = insertCut(completed.base, completed.hit, completed.hit.point);
      commitContourEdit(completed.base, after, "Cut zone edge");
    } else if (completed.kind === "segment" || completed.kind === "vertex") {
      if (completed.moved) commitContourEdit(completed.base, shapeEdit.contour, "Edit zone shape");
      else shapeEdit.contour = cloneContour(completed.base);
    } else if (completed.kind === "marquee" && completed.moved) {
      shapeEdit.marquee = rectBetween(completed.startWorld, worldPoint(event));
    } else if (completed.kind === "marquee") {
      shapeEdit.marquee = null;
    }
  }

  function pointerCancel(event: PointerEvent): void {
    const activeGesture = gesture;
    if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
    gesture = null;
    hoverEdge = null;
    shapeEdit.marquee = null;
    if (shapeEdit.zoneId) shapeEdit.contour = cloneContour(activeGesture.base);
    release(event.pointerId);
  }

  function keyDown(event: KeyboardEvent): void {
    if (!shapeEdit.zoneId || event.defaultPrevented || isTextEditingTarget(event.target)) return;

    if (event.code === "Escape") {
      const activeGesture = gesture;
      const clearActiveMarquee = activeGesture?.kind === "marquee" && shapeEdit.marquee !== null;
      if (activeGesture) cancelGesture();
      if (clearActiveMarquee) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (event.repeat) return;

    if (event.code === "Enter" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      cancelGesture();
      leaveShapeEdit();
      event.preventDefault();
      event.stopImmediatePropagation();
      gesture = null;
      return;
    }

    if ((event.code === "Delete" || event.code === "Backspace") && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (shapeEdit.marquee) cutOutShapeEditArea();
      return;
    }

    if (event.code === "KeyZ" && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && history.cursor <= shapeEdit.entryCursor) {
      leaveShapeEdit();
      gesture = null;
    }
  }

  function cancelGesture(): void {
    const activeGesture = gesture;
    if (!activeGesture) return;
    gesture = null;
    release(activeGesture.pointerId);
    if (shapeEdit.zoneId) shapeEdit.contour = cloneContour(activeGesture.base);
    shapeEdit.marquee = null;
  }

  function onWindowBlur(): void {
    const activeGesture = gesture;
    if (!activeGesture) return;
    gesture = null;
    shapeEdit.marquee = null;
    if (shapeEdit.zoneId) shapeEdit.contour = cloneContour(activeGesture.base);
  }

  function capture(pointerId: number): void {
    try {
      boardElement?.setPointerCapture(pointerId);
    } catch {
      // Window listeners still finish the gesture if the WebView rejects capture.
    }
  }

  function release(pointerId: number): void {
    try {
      if (boardElement?.hasPointerCapture(pointerId)) boardElement.releasePointerCapture(pointerId);
    } catch {
      // Capture may already have been released by the browser.
    }
  }

  function nearZoneBounds(point: Point, bounds: ZoneBounds, margin: number): boolean {
    return point.x >= bounds.x - margin && point.x <= bounds.x + bounds.width + margin &&
      point.y >= bounds.y - margin && point.y <= bounds.y + bounds.height + margin;
  }

  function rectBetween(first: Point, second: Point): ZoneBounds {
    return {
      x: Math.min(first.x, second.x),
      y: Math.min(first.y, second.y),
      width: Math.abs(second.x - first.x),
      height: Math.abs(second.y - first.y),
    };
  }

  function distanceSquared(first: Point, second: Point): number {
    return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
  }

  function cloneContour(contour: EditContour): EditContour {
    return { rings: contour.rings.map((ring) => ({ kind: ring.kind, points: ring.points.map((point) => ({ ...point })) })) };
  }

  $effect(() => {
    const id = shapeEdit.zoneId;
    if (id && (!zones.byId[id] || tool.active !== "select")) {
      gesture = null;
      leaveShapeEdit();
    }
  });

  onMount(() => {
    boardElement = document.querySelector<HTMLDivElement>(".board");
    if (!boardElement) return;

    boardElement.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("pointermove", pointerMove, true);
    window.addEventListener("pointerup", pointerUp, true);
    window.addEventListener("pointercancel", pointerCancel, true);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      boardElement?.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("pointermove", pointerMove, true);
      window.removeEventListener("pointerup", pointerUp, true);
      window.removeEventListener("pointercancel", pointerCancel, true);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  });
</script>

{#if shapeEdit.zoneId && activeZone && shapeEdit.contour}
  <div class="shape-editor" role="group" aria-label="Zone shape editor">
    <svg class="shape-svg" width="100%" height="100%" aria-hidden="true">
      <g transform={transform}>
        {#each shapeEdit.contour.rings as ring, ringIndex (`${ring.kind}-${ringIndex}`)}
          <polygon
            points={ringPoints(ring.points)}
            class="shape-edge"
            class:shape-hole={ring.kind === "hole"}
            stroke={activeZone.color}
            vector-effect="non-scaling-stroke"
          />
          {#each ring.points as point, vertexIndex (`${ringIndex}-${vertexIndex}`)}
            <rect
              x={point.x - markerSize / 2}
              y={point.y - markerSize / 2}
              width={markerSize}
              height={markerSize}
              class="shape-vertex"
              stroke={activeZone.color}
              vector-effect="non-scaling-stroke"
            />
          {/each}
        {/each}
        {#if hoverEdge}
          <rect
            x={hoverEdge.point.x - markerSize / 2}
            y={hoverEdge.point.y - markerSize / 2}
            width={markerSize}
            height={markerSize}
            class="shape-cut-marker"
            stroke={activeZone.color}
            vector-effect="non-scaling-stroke"
          />
        {/if}
        {#if shapeEdit.marquee}
          <rect
            x={shapeEdit.marquee.x}
            y={shapeEdit.marquee.y}
            width={shapeEdit.marquee.width}
            height={shapeEdit.marquee.height}
            class="shape-cut-marquee"
            vector-effect="non-scaling-stroke"
          />
        {/if}
      </g>
    </svg>
    <div class="shape-edit-status" data-selection-ignore role="status">
      Editing shape · click edge to cut · drag edges/corners · Ctrl+drag corner to scale · drag area + Delete to cut out · Enter/Esc to finish
    </div>
  </div>
{/if}

<style>
  .shape-editor {
    position: absolute;
    z-index: 1;
    inset: 0;
    pointer-events: auto;
  }

  .shape-svg {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }

  .shape-edge {
    fill: none;
    stroke-width: 1.5px;
    stroke-linejoin: miter;
    pointer-events: none;
  }

  .shape-hole {
    stroke-dasharray: 4 3;
  }

  .shape-vertex {
    fill: #1c1c1c;
    stroke-width: 1px;
    pointer-events: none;
  }

  .shape-cut-marker {
    fill: #f3d57a;
    stroke-width: 1.25px;
    pointer-events: none;
  }

  .shape-cut-marquee {
    fill: #e5ba56;
    fill-opacity: 0.12;
    stroke: #f1cf79;
    stroke-width: 1px;
    stroke-dasharray: 4 3;
    pointer-events: none;
  }

  .shape-edit-status {
    position: absolute;
    z-index: 2;
    top: 44px;
    left: 50%;
    max-width: min(780px, calc(100% - 24px));
    box-sizing: border-box;
    padding: 5px 9px;
    border: 1px solid #57513e;
    border-radius: 4px;
    color: #f1e2b9;
    background: rgb(35 33 28 / 94%);
    box-shadow: 0 2px 8px rgb(0 0 0 / 32%);
    font-size: 11px;
    line-height: 1.35;
    text-align: center;
    transform: translateX(-50%);
    pointer-events: none;
  }

  :global(.board.shape-editing .links-layer),
  :global(.board.shape-editing .links-layer *),
  :global(.board.shape-editing .notes-layer),
  :global(.board.shape-editing .notes-layer *),
  :global(.board.shape-editing .beacons-layer),
  :global(.board.shape-editing .beacons-layer *),
  :global(.board.shape-editing .selection-layer),
  :global(.board.shape-editing .selection-layer *) {
    pointer-events: none !important;
  }

  :global(.board.shape-editing .selection-layer .zone-resize-handle) {
    display: none !important;
  }
</style>
