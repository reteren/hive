<script lang="ts">
  import { onMount } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld, type Point } from "../board/cameraMath";
  import { isTextEditingTarget } from "../commands/focus";
  import { board } from "../model/board.svelte";
  import { links, canLink } from "../model/links.svelte";
  import type { Link } from "../model/link";
  import { newId } from "../model/note";
  import { noteBounds } from "../notes/layout.svelte";
  import { clearSelection } from "../selection/selection.svelte";
  import { tool } from "../tools/tool.svelte";
  import { objectColor } from "./colors";
  import { linePathBetweenFrames, pathData, scalePath, strokeIntersectsPath, type LinkPath } from "./lineGeometry";
  import { cancelLineDraft, lineInteraction, setLineError } from "./interaction.svelte";
  import { changeLinkShape, createBoardLink, cutLinks } from "./operations";
  import { clearSelectedLink, selectLink, selectedLink } from "./selection.svelte";

  const CUT_DRAG_THRESHOLD_PX = 5;
  const CUT_TOLERANCE_PX = 4;

  interface RenderedLink {
    id: string;
    kind: Link["kind"];
    geometry: LinkPath;
    path: string;
    selected: boolean;
    gradient: null | {
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      fromColor: string;
      toColor: string;
    };
  }

  type PointerGesture =
    | { kind: "link"; id: number; fromId: string; continuation: boolean; start: Point }
    | { kind: "cut"; id: number; start: Point; startLinkId: string | null };

  interface PreviewLink {
    path: string;
    kind: Link["kind"];
  }

  let layer: HTMLDivElement;
  let gesture: PointerGesture | null = null;
  let worldTransform = $derived(
    `translate3d(${viewport.width / 2}px, ${viewport.height / 2}px, 0) ` +
      `scale(${camera.zoom}) ` +
      `translate3d(${-camera.x * PX_PER_UNIT}px, ${-camera.y * PX_PER_UNIT}px, 0)`,
  );

  let renderedLinks = $derived.by((): RenderedLink[] => Object.values(links.byId).flatMap((link) => {
    const from = board.notes[link.from];
    const to = board.notes[link.to];
    if (!from || !to) return [];

    const geometry = linePathBetweenFrames(link.shape, noteBounds(from), noteBounds(to));
    const scaled = scalePath(geometry, PX_PER_UNIT);
    const first = geometry.points[0];
    const last = geometry.type === "cubic" ? geometry.points[3] : geometry.points.at(-1);
    if (!first || !last) return [];

    const fromColor = objectColor(link.from);
    const toColor = objectColor(link.to);
    const gradient = fromColor.toLowerCase() === toColor.toLowerCase()
      ? null
      : {
          id: `hive-link-${safeId(link.id)}`,
          x1: first.x * PX_PER_UNIT,
          y1: first.y * PX_PER_UNIT,
          x2: last.x * PX_PER_UNIT,
          y2: last.y * PX_PER_UNIT,
          fromColor,
          toColor,
        };

    return [{
      id: link.id,
      kind: link.kind,
      geometry,
      path: pathData(scaled),
      selected: selectedLink.id === link.id,
      gradient,
    }];
  }));

  let gradients = $derived(renderedLinks.flatMap((link) => link.gradient ? [link.gradient] : []));

  let previewLink = $derived.by((): PreviewLink | null => {
    const source = lineInteraction.sourceId ? board.notes[lineInteraction.sourceId] : undefined;
    const point = lineInteraction.preview;
    if (!source || !point || (tool.active !== "line-strong" && tool.active !== "line-weak")) return null;

    const target = { x: point.x, y: point.y, width: 0, height: 0 };
    const geometry = linePathBetweenFrames(tool.lineShape, noteBounds(source), target);
    return {
      path: pathData(scalePath(geometry, PX_PER_UNIT)),
      kind: tool.active === "line-weak" ? "weak" : "strong",
    };
  });

  onMount(() => {
    const parent = layer.parentElement;
    if (!parent) return;
    const surface: HTMLElement = parent;

    function localPoint(event: Pick<PointerEvent, "clientX" | "clientY">): Point {
      const rect = surface.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function noteAt(point: Point, preferredTarget: EventTarget | null): string | null {
      const target = preferredTarget instanceof Element ? preferredTarget : null;
      const noteRoot = target?.closest<HTMLElement>("[data-note-id]");
      const directId = noteRoot?.dataset.noteId;
      if (directId && board.notes[directId]) return directId;

      const world = screenToWorld(camera, viewport, point);
      for (const id of [...board.order].reverse()) {
        const note = board.notes[id];
        if (!note) continue;
        const bounds = noteBounds(note);
        if (world.x >= bounds.x && world.x <= bounds.x + bounds.width &&
          world.y >= bounds.y && world.y <= bounds.y + bounds.height) return id;
      }
      return null;
    }

    function linkAt(target: EventTarget | null): string | null {
      if (!(target instanceof Element)) return null;
      const id = target.closest<SVGGElement>("[data-link-id]")?.dataset.linkId;
      return id && links.byId[id] ? id : null;
    }

    function capturePointer(event: PointerEvent): void {
      if (event.button !== 0 || isTextEditingTarget(event.target)) return;
      const point = localPoint(event);

      if (tool.active === "line-strong" || tool.active === "line-weak") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const noteId = noteAt(point, event.target);
        if (!noteId) {
          if (lineInteraction.sourceId) cancelLineDraft();
          return;
        }

        const continuation = lineInteraction.sourceId !== null;
        gesture = {
          kind: "link",
          id: event.pointerId,
          fromId: lineInteraction.sourceId ?? noteId,
          continuation,
          start: point,
        };
        lineInteraction.preview = screenToWorld(camera, viewport, point);
        try { surface.setPointerCapture(event.pointerId); } catch { /* Window handlers still track the gesture. */ }
        return;
      }

      if (tool.active === "line-cut") {
        event.preventDefault();
        event.stopImmediatePropagation();
        gesture = { kind: "cut", id: event.pointerId, start: point, startLinkId: linkAt(event.target) };
        lineInteraction.cutStroke = [point];
        try { surface.setPointerCapture(event.pointerId); } catch { /* Window handlers still track the gesture. */ }
        return;
      }

      const linkId = linkAt(event.target);
      if (linkId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearSelection();
        selectLink(linkId);
        return;
      }
      clearSelectedLink();
    }

    function onPointerMove(event: PointerEvent): void {
      const point = localPoint(event);
      if (gesture?.id === event.pointerId) {
        if (gesture.kind === "cut") {
          const lastPoint = lineInteraction.cutStroke.at(-1);
          if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= 2) {
            lineInteraction.cutStroke = [...lineInteraction.cutStroke, point];
          }
        } else {
          lineInteraction.preview = screenToWorld(camera, viewport, point);
        }
      } else if (lineInteraction.sourceId && (tool.active === "line-strong" || tool.active === "line-weak")) {
        lineInteraction.preview = screenToWorld(camera, viewport, point);
      }
    }

    function tryCreate(fromId: string, toId: string, point: Point): boolean {
      if (fromId === toId) {
        setLineError("A note cannot link to itself", point);
        lineInteraction.sourceId = fromId;
        return false;
      }
      if (!canLink(fromId, toId)) {
        setLineError("These notes already have a link", point);
        lineInteraction.sourceId = fromId;
        return false;
      }
      const link: Link = {
        id: newId(),
        from: fromId,
        to: toId,
        kind: tool.active === "line-weak" ? "weak" : "strong",
        shape: tool.lineShape,
      };
      if (!createBoardLink(link)) {
        setLineError("Could not create link", point);
        lineInteraction.sourceId = fromId;
        return false;
      }
      cancelLineDraft();
      return true;
    }

    function finishCut(active: Extract<PointerGesture, { kind: "cut" }>, point: Point): void {
      const stroke = [...lineInteraction.cutStroke];
      const last = stroke.at(-1);
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1) stroke.push(point);
      lineInteraction.cutStroke = [];

      const dragged = Math.hypot(point.x - active.start.x, point.y - active.start.y) >= CUT_DRAG_THRESHOLD_PX;
      if (!dragged) {
        if (active.startLinkId) cutLinks([active.startLinkId]);
        return;
      }

      const worldStroke = stroke.map((screenPoint) => screenToWorld(camera, viewport, screenPoint));
      const tolerance = CUT_TOLERANCE_PX / (PX_PER_UNIT * camera.zoom);
      const crossed = renderedLinks
        .filter((link) => strokeIntersectsPath(worldStroke, link.geometry, tolerance))
        .map((link) => link.id);
      if (crossed.length > 0) cutLinks(crossed);
    }

    function finishPointer(event: PointerEvent): void {
      if (!gesture || gesture.id !== event.pointerId) return;
      const active = gesture;
      gesture = null;
      const point = localPoint(event);

      if (active.kind === "cut") {
        finishCut(active, point);
        return;
      }

      const moved = Math.hypot(point.x - active.start.x, point.y - active.start.y) > 5;
      const toId = noteAt(point, event.target);

      if (active.continuation) {
        if (toId) tryCreate(active.fromId, toId, point);
        else cancelLineDraft();
      } else if (!moved) {
        lineInteraction.sourceId = active.fromId;
        lineInteraction.preview = screenToWorld(camera, viewport, point);
      } else if (toId) {
        tryCreate(active.fromId, toId, point);
      } else {
        cancelLineDraft();
      }
    }

    function onPointerCancel(event: PointerEvent): void {
      if (!gesture || gesture.id !== event.pointerId) return;
      gesture = null;
      cancelLineDraft();
    }

    surface.addEventListener("pointerdown", capturePointer, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", finishPointer, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    surface.addEventListener("lostpointercapture", onPointerCancel, true);
    return () => {
      cancelLineDraft();
      surface.removeEventListener("pointerdown", capturePointer, true);
      surface.removeEventListener("lostpointercapture", onPointerCancel, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", finishPointer, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
    };
  });

  function safeId(value: string): string {
    return [...value].map((character) => /^[a-z\d_-]$/i.test(character)
      ? character
      : `_${character.codePointAt(0)?.toString(16) ?? "0"}_`).join("");
  }
</script>

<div class="links-layer" bind:this={layer}>
  <div class="links-world" style:transform={worldTransform}>
    <svg class="links-svg" width="100%" height="100%" aria-hidden="true">
      <defs>
        <marker id="hive-link-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 1 L 9 5 L 0 9 z" />
        </marker>
        {#each gradients as gradient (gradient.id)}
          <linearGradient
            id={gradient.id}
            gradientUnits="userSpaceOnUse"
            x1={gradient.x1}
            y1={gradient.y1}
            x2={gradient.x2}
            y2={gradient.y2}
          >
            <stop offset="0%" stop-color={gradient.fromColor} />
            <stop offset="100%" stop-color={gradient.toColor} />
          </linearGradient>
        {/each}
      </defs>
      {#each renderedLinks as link (link.id)}
        <g data-link-id={link.id} class:selected={link.selected}>
          <path class="link-hit" d={link.path} />
          <path
            class="link-line"
            class:weak={link.kind === "weak"}
            d={link.path}
            style:stroke={link.selected ? "var(--accent)" : link.gradient ? `url(#${link.gradient.id})` : undefined}
            marker-end={link.kind === "strong" ? "url(#hive-link-arrow)" : undefined}
          />
        </g>
      {/each}
      {#if previewLink}
        <path
          class="link-line link-preview"
          class:weak={previewLink.kind === "weak"}
          d={previewLink.path}
          marker-end={previewLink.kind === "strong" ? "url(#hive-link-arrow)" : undefined}
        />
      {/if}
    </svg>
  </div>
  {#if lineInteraction.cutStroke.length > 1}
    <svg class="cut-preview" data-selection-ignore width="100%" height="100%" aria-hidden="true">
      <polyline points={lineInteraction.cutStroke.map((point) => `${point.x},${point.y}`).join(" ")} />
    </svg>
  {/if}
  {#if lineInteraction.error}
    <div
      class="line-error"
      data-selection-ignore
      role="status"
      style:left="{lineInteraction.error.x + 12}px"
      style:top="{lineInteraction.error.y + 12}px"
    >{lineInteraction.error.message}</div>
  {/if}
</div>

<style>
  .links-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .links-world {
    position: absolute;
    inset: 0;
    overflow: visible;
    transform-origin: 0 0;
    pointer-events: none;
    will-change: transform;
  }

  .links-svg {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }

  .links-svg g {
    pointer-events: auto;
    cursor: pointer;
  }

  .link-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 14px;
    vector-effect: non-scaling-stroke;
    pointer-events: stroke;
  }

  .link-line {
    fill: none;
    stroke: #a9a294;
    stroke-width: 1.6px;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }

  .link-line.weak {
    stroke-dasharray: 5 4;
  }

  .link-line.link-preview {
    stroke: #c5ad72;
    stroke-dasharray: 4 3;
    opacity: 0.85;
  }

  .link-preview.weak {
    stroke: #a1b6bd;
  }

  .selected .link-line {
    stroke: var(--accent);
    stroke-width: 2.2px;
  }

  marker path {
    fill: #a9a294;
    fill: context-stroke;
  }

  .cut-preview {
    position: absolute;
    z-index: 40;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }

  .cut-preview polyline {
    fill: none;
    stroke: #ffe17a;
    stroke-width: 2px;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .line-error {
    position: absolute;
    z-index: 41;
    max-width: 240px;
    padding: 4px 7px;
    border: 1px solid #735b28;
    border-radius: 3px;
    color: var(--text);
    background: rgba(35, 32, 25, 0.96);
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
