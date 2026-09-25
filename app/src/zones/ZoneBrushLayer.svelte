<script lang="ts">
  import { onMount } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld, type Point } from "../board/cameraMath";
  import { isTextEditingTarget } from "../commands/focus";
  import { zones } from "../model/zones.svelte";
  import { tool } from "../tools/tool.svelte";
  import { brushState, stepBrushSize } from "./brushState.svelte";
  import { brushSquare } from "./brush";
  import {
    appendBrushGesturePoint,
    brushStrokeState,
    cancelBrushGesture,
    commitBrushGesture,
    finishBrushGesture,
    resolvePaintTarget,
    setBrushCursor,
    startBrushGesture,
    type BrushMode,
  } from "./brushStroke.svelte";

  const NEW_ZONE_PREVIEW = "#8295a7";
  let layer: HTMLDivElement;
  let surface: HTMLElement | null = null;
  let animationFrame: number | null = null;
  let wheelRemainder = 0;
  /** Pointer samples waiting for the next frame; `free` = Shift was held (no grid snapping). */
  const pendingPoints: { point: Point; free: boolean }[] = [];

  const transform = $derived(
    `translate(${viewport.width / 2} ${viewport.height / 2}) scale(${camera.zoom * PX_PER_UNIT}) translate(${-camera.x} ${-camera.y})`,
  );
  const cursorBounds = $derived(
    brushStrokeState.cursor && !brushStrokeState.gesture?.rectangle
      ? brushSquare(brushStrokeState.cursor, brushState.size, !brushStrokeState.free)
      : null,
  );

  function local(clientX: number, clientY: number, allowOutside = false): Point | null {
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const point = { x: clientX - rect.left, y: clientY - rect.top };
    if (!allowOutside && (point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height)) return null;
    return point;
  }

  function world(clientX: number, clientY: number, allowOutside = false): Point | null {
    const screen = local(clientX, clientY, allowOutside);
    return screen ? screenToWorld(camera, viewport, screen) : null;
  }

  function entries(): { id: string; shape: { parts: Point[][]; holes: Point[][] } }[] {
    return zones.order.flatMap((id) => {
      const zone = zones.byId[id];
      return zone ? [{ id, shape: { parts: zone.parts, holes: zone.holes } }] : [];
    });
  }

  function shouldIgnoreTarget(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest(
      "[data-note-id], [data-beacon-id], [data-link-id], [data-selection-ignore], button, input, textarea, [contenteditable='true']",
    ));
  }

  function scheduleFlush(): void {
    if (animationFrame !== null) return;
    animationFrame = requestAnimationFrame(flushPendingPoints);
  }

  function flushPendingPoints(): void {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    const points = pendingPoints.splice(0);
    for (const { point, free } of points) appendBrushGesturePoint(point, brushState.size, free);
  }

  function clearStroke(): void {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    pendingPoints.length = 0;
    cancelBrushGesture();
  }

  onMount(() => {
    surface = layer.parentElement;
    if (!surface) return;

    function onPointerDown(event: PointerEvent): void {
      if (tool.active !== "zone" || (event.button !== 0 && event.button !== 2) ||
        isTextEditingTarget(event.target) || shouldIgnoreTarget(event.target)) return;
      const point = world(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      surface?.setPointerCapture(event.pointerId);
      const mode: BrushMode = event.button === 0 ? "paint" : "erase";
      const targetZoneId = mode === "paint" ? resolvePaintTarget(point, entries()) : null;
      brushStrokeState.free = event.shiftKey;
      pendingPoints.length = 0;
      startBrushGesture(event.pointerId, mode, point, event.ctrlKey, targetZoneId, brushState.size);
    }

    function onPointerMove(event: PointerEvent): void {
      const gesture = brushStrokeState.gesture;
      if (gesture && gesture.pointerId !== event.pointerId) return;
      const point = world(event.clientX, event.clientY, gesture !== null);
      if (!point) {
        if (!gesture) setBrushCursor(null);
        return;
      }
      brushStrokeState.free = event.shiftKey;
      setBrushCursor(point);
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingPoints.push({ point, free: event.shiftKey });
      scheduleFlush();
    }

    function finish(event: PointerEvent): void {
      const active = brushStrokeState.gesture;
      if (!active || active.pointerId !== event.pointerId) return;
      const point = world(event.clientX, event.clientY, true);
      if (point) pendingPoints.push({ point, free: event.shiftKey });
      flushPendingPoints();
      const completed = finishBrushGesture();
      pendingPoints.length = 0;
      if (surface?.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
      if (completed) commitBrushGesture(completed);
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function cancel(event: PointerEvent): void {
      if (brushStrokeState.gesture?.pointerId !== event.pointerId) return;
      clearStroke();
      if (surface?.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function onContextMenu(event: MouseEvent): void {
      if (tool.active !== "zone") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function onWheel(event: WheelEvent): void {
      if (!event.ctrlKey || tool.active !== "zone") {
        wheelRemainder = 0;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const notchDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY / 3
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY
          : event.deltaY / 120;
      wheelRemainder += notchDelta;
      const notches = Math.trunc(wheelRemainder);
      wheelRemainder -= notches;
      for (let notch = 0; notch < Math.abs(notches); notch += 1) stepBrushSize(notches > 0 ? -1 : 1);
    }

    /** Shift toggles grid-free painting; update the cursor preview without waiting for a mouse move. */
    function onShift(event: KeyboardEvent): void {
      if (event.key === "Shift") brushStrokeState.free = event.type === "keydown";
    }

    function onKeyDown(event: KeyboardEvent): void {
      onShift(event);
      if (event.code !== "Escape" || event.defaultPrevented || tool.active !== "zone" || !brushStrokeState.gesture) return;
      const pointerId = brushStrokeState.gesture.pointerId;
      clearStroke();
      if (surface?.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function onPointerLeave(): void {
      if (!brushStrokeState.gesture) setBrushCursor(null);
    }

    surface.addEventListener("pointerdown", onPointerDown, true);
    surface.addEventListener("contextmenu", onContextMenu, true);
    surface.addEventListener("wheel", onWheel, { capture: true, passive: false });
    surface.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onShift, true);
    return () => {
      surface?.removeEventListener("pointerdown", onPointerDown, true);
      surface?.removeEventListener("contextmenu", onContextMenu, true);
      surface?.removeEventListener("wheel", onWheel, true);
      surface?.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onShift, true);
      brushStrokeState.free = false;
      clearStroke();
      setBrushCursor(null);
    };
  });

  function shapePath(shape: { parts: Point[][]; holes: Point[][] }): string {
    return [...shape.parts, ...shape.holes]
      .map((ring) => ring.length ? `M ${ring.map((point) => `${point.x} ${point.y}`).join(" L ")} Z` : "")
      .join(" ");
  }
</script>

<div class="zone-brush-layer" bind:this={layer} aria-hidden="true">
  <svg class="brush-svg" width="100%" height="100%">
    <defs>
      <pattern id="zone-brush-erase" patternUnits="userSpaceOnUse" width="8" height="8">
        <rect width="8" height="8" fill="#9c3f46" fill-opacity="0.18" />
        <path d="M -2 2 L 2 -2 M 0 8 L 8 0 M 6 10 L 10 6" stroke="#ff7378" stroke-width="1.2" />
      </pattern>
    </defs>
    <g transform={transform}>
      {#if brushStrokeState.gesture}
        {@const gesture = brushStrokeState.gesture}
        {@const targetColor = gesture.targetZoneId ? zones.byId[gesture.targetZoneId]?.color : null}
        {@const fill = gesture.mode === "erase" ? "url(#zone-brush-erase)" : targetColor ?? NEW_ZONE_PREVIEW}
        <path
          d={shapePath(gesture.shape)}
          fill={fill}
          fill-opacity={gesture.mode === "erase" ? 1 : 0.22}
          fill-rule="evenodd"
          stroke={gesture.mode === "erase" ? "#f16f75" : targetColor ?? NEW_ZONE_PREVIEW}
          stroke-width="1.5"
          stroke-dasharray={gesture.mode === "erase" ? "4 3" : undefined}
          vector-effect="non-scaling-stroke"
        />
      {/if}
      {#if cursorBounds}
        <rect
          class="brush-cursor"
          x={cursorBounds.x}
          y={cursorBounds.y}
          width={cursorBounds.width}
          height={cursorBounds.height}
        />
      {/if}
    </g>
  </svg>
</div>

<style>
  .zone-brush-layer, .brush-svg { position: absolute; inset: 0; pointer-events: none; }
  .brush-svg { overflow: visible; }
  .brush-cursor { fill: #f2d34c; fill-opacity: 0.05; stroke: #f2d34c; stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
</style>
