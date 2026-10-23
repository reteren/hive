<script lang="ts">
  import { onMount } from "svelte";
  import { camera, ME_POSITION, viewport } from "../board/camera.svelte";
  import { cachedClientRect } from "../board/boardRect";
  import { lod, queryPoint, visible } from "../board/visibility.svelte";
  import { PX_PER_UNIT, screenToWorld, type Point } from "../board/cameraMath";
  import { isTextEditingTarget } from "../commands/focus";
  import { board, onBoardMutation } from "../model/board.svelte";
  import { links, linksOf, onLinksMutation, canLink, linkRefusalReason } from "../model/links.svelte";
  import { ME_OBJECT_ID, type Link, type LinkAnchor } from "../model/link";
  import { hasMeBeacon } from "../beacons/beaconState.svelte";
  import { BEACON_SIZE, newId } from "../model/note";
  import { noteBounds, type Bounds } from "../notes/layout.svelte";
  import { captureSelectionSnapshot, setSelectionUndoable } from "../selection/selection.svelte";
  import { isLineTool, tool } from "../tools/tool.svelte";
  import { objectColor } from "./colors";
  import { marqueeIntersectsPath, strokeIntersectsPath } from "./lineGeometry";
  import { buildArrowGeometry, buildShape, buildShapeDashPaths, type ShapeResult } from "./shapes";
  import { pointOnCircleToward, projectPointToAnchor, resolveLinkEndpoints, shapeEndpoints } from "./anchors";
  import { startSmoothLineSync } from "./smoothLineSync.svelte";
  import { clientToBoardPoint, clientToWorld } from "./coordinates";
  import { completeLinkGesture, previewLinkKind, resolveCutRelease, shouldSuppressLineCutContextMenu, type LinkDraft } from "./gestures";
  import { cancelLineDraft, lineInteraction, setLineError } from "./interaction.svelte";
  import { createBoardLink, cutLinks } from "./operations";
  import { effectiveLinkKind } from "./rules";
  import {
    clearLinkSelectionUndoable,
    selectedLinkIds,
    selectLinkUndoable,
    selectLinksUndoable,
  } from "./selection.svelte";
  import { isDimmed, visibleInFocus } from "../beacons/focus.svelte";
  import { linkRouteIndex } from "./routeIndex";
  import { t } from "../i18n/i18n.svelte";

  const CUT_DRAG_THRESHOLD_PX = 5;
  const CUT_TOLERANCE_PX = 4;
  const ME_RADIUS = BEACON_SIZE / 2;

  interface RenderedLink {
    id: string;
    kind: Link["kind"];
    geometry: ShapeResult;
    path: string;
    shaftPath: string;
    headPath: string | null;
    dashPaths: string[] | null;
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

  interface LinkRenderCache {
    link: Link;
    from: string;
    to: string;
    kind: Link["kind"];
    shape: Link["shape"];
    fromAnchor: string;
    toAnchor: string;
    source: Bounds;
    target: Bounds;
    fromColor: string;
    toColor: string;
    selected: boolean;
    rendered: RenderedLink;
  }

  type PointerGesture =
    | {
        kind: "link";
        id: number;
        clickedId: string;
        clickedAnchor?: LinkAnchor;
        draft: LinkDraft | null;
        startedInBody: boolean;
        captured: boolean;
        start: Point;
      }
    | { kind: "cut"; id: number; start: Point; startLinkId: string | null; captured: boolean }
    | { kind: "marquee"; id: number; start: Point; captured: boolean };

  interface PreviewLink {
    path: string;
    headPath: string | null;
    dashPaths: string[] | null;
    kind: Link["kind"];
  }

  let layer: HTMLDivElement;
  const renderedLinkCache = new Map<string, LinkRenderCache>();
  const routeIndex = linkRouteIndex;
  const dirtyLinkIds = new Set<string>();
  const orderIndex = new Map(board.order.map((id, index) => [id, index]));
  let allLinksDirty = true;
  let renderedRevision = $state(0);
  let hoveredLinkId = $state<string | null>(null);
  let activeCutLinkId = $state<string | null>(null);
  let gesture: PointerGesture | null = null;
  let linkMarquee = $state<{ start: Point; end: Point } | null>(null);
  let lastBodyClick: { id: string; at: number } | null = null;
  let textSelectionElement: HTMLElement | null = null;
  let previousUserSelect = "";
  // Applied as an SVG attribute so the browser re-renders the vectors at the current zoom;
  // a CSS transform on the wrapper would rasterise once and stretch the bitmap (blurry lines).
  let worldTransform = $derived(
    `translate(${viewport.width / 2} ${viewport.height / 2}) ` +
      `scale(${camera.zoom * PX_PER_UNIT}) ` +
      `translate(${-camera.x} ${-camera.y})`,
  );

  let renderedLinks = $derived.by((): RenderedLink[] => {
    void renderedRevision;
    const selectedIds = new Set(selectedLinkIds());
    const focusedIds = visibleInFocus();
    syncDirtyLinkGeometry();
    const candidateIds = new Set(routeIndex.query(visible.rect));
    for (const id of selectedIds) candidateIds.add(id);
    if (hoveredLinkId) candidateIds.add(hoveredLinkId);
    if (activeCutLinkId) candidateIds.add(activeCutLinkId);
    const rendered: RenderedLink[] = [];
    for (const id of candidateIds) {
      const cache = renderedLinkCache.get(id);
      if (!cache) continue;
      const selected = selectedIds.has(id) || id === hoveredLinkId || id === activeCutLinkId;
      const focused = Boolean(focusedIds?.has(cache.from) && focusedIds.has(cache.to));
      if (lod.tier === "min" && !selected && !focused) continue;
      rendered.push(cache.rendered.selected === selected ? cache.rendered : { ...cache.rendered, selected });
    }
    return rendered;
  });

  // A group drag reports every moved note separately; bump the reactive revision once per microtask.
  let revisionQueued = false;
  function queueRenderedRevision(): void {
    if (revisionQueued) return;
    revisionQueued = true;
    queueMicrotask(() => {
      revisionQueued = false;
      renderedRevision += 1;
    });
  }

  onBoardMutation((ids) => {
    if (ids === null) {
      allLinksDirty = true;
      rebuildOrderIndex();
    } else {
      for (const id of ids) {
        for (const link of linksOf(id)) dirtyLinkIds.add(link.id);
        if (!board.notes[id] || !orderIndex.has(id)) rebuildOrderIndex();
      }
    }
    queueRenderedRevision();
  });
  onLinksMutation((ids) => {
    if (ids === null) allLinksDirty = true;
    else for (const id of ids) dirtyLinkIds.add(id);
    queueRenderedRevision();
  });

  $effect.root(() => {
    $effect(() => {
      hasMeBeacon();
      for (const link of linksOf(ME_OBJECT_ID)) dirtyLinkIds.add(link.id);
      // Deferred bump: `renderedRevision += 1` here would read the revision and make this effect
      // re-run after every bump, rebuilding the visible link list in an endless loop.
      queueRenderedRevision();
    });
  });

  function syncDirtyLinkGeometry(): void {
    if (allLinksDirty) {
      routeIndex.clear();
      const activeIds = new Set(Object.keys(links.byId));
      for (const id of renderedLinkCache.keys()) if (!activeIds.has(id)) renderedLinkCache.delete(id);
      for (const id of activeIds) refreshLinkGeometry(id, true);
      allLinksDirty = false;
      dirtyLinkIds.clear();
      return;
    }
    for (const id of dirtyLinkIds) refreshLinkGeometry(id, false);
    dirtyLinkIds.clear();
  }

  function rebuildOrderIndex(): void {
    orderIndex.clear();
    for (let index = 0; index < board.order.length; index += 1) orderIndex.set(board.order[index]!, index);
  }

  function refreshLinkGeometry(id: string, forceIndex = false): void {
    const link = links.byId[id];
    if (!link) {
      renderedLinkCache.delete(id);
      routeIndex.delete(id);
      return;
    }
    const source = objectBounds(link.from);
    const target = objectBounds(link.to);
    if (!source || !target) {
      renderedLinkCache.delete(id);
      routeIndex.delete(id);
      return;
    }
    const fromColor = objectColor(link.from);
    const toColor = objectColor(link.to);
    const cache = renderedLinkCache.get(id);
    if (cache && sameLinkRenderInputs(cache, link, source, target, fromColor, toColor, false)) {
      if (forceIndex) routeIndex.set(id, cache.rendered.geometry.polyline);
      return;
    }
    const geometry = geometryForLink(link, source, target);
    const first = geometry?.polyline[0];
    const last = geometry?.polyline.at(-1);
    if (!geometry || !first || !last) {
      renderedLinkCache.delete(id);
      routeIndex.delete(id);
      return;
    }
    const gradient = fromColor.toLowerCase() === toColor.toLowerCase()
      ? null
      : {
          id: `hive-link-${safeId(id)}`,
          x1: first.x,
          y1: first.y,
          x2: last.x,
          y2: last.y,
          fromColor,
          toColor,
        };
    const arrow = buildArrowGeometry(link.shape, geometry);
    const shapeDashes = link.kind === "weak" && (link.shape === "wave" || link.shape === "zigzag")
      ? buildShapeDashPaths(link.shape, geometry, arrow.shaftLength)
      : [];
    const value: RenderedLink = {
      id,
      kind: link.kind,
      geometry,
      path: geometry.path,
      shaftPath: arrow.shaftPath,
      headPath: arrow.headPath,
      dashPaths: shapeDashes.length > 0 ? shapeDashes : null,
      selected: false,
      gradient,
    };
    renderedLinkCache.set(id, {
      link,
      from: link.from,
      to: link.to,
      kind: link.kind,
      shape: link.shape,
      fromAnchor: anchorKey(link.fromAnchor),
      toAnchor: anchorKey(link.toAnchor),
      source,
      target,
      fromColor,
      toColor,
      selected: false,
      rendered: value,
    });
    routeIndex.set(id, geometry.polyline);
  }

  let gradients = $derived(renderedLinks.flatMap((link) => link.gradient ? [link.gradient] : []));

  let previewLink = $derived.by((): PreviewLink | null => {
    const sourceId = lineInteraction.sourceId;
    const source = sourceId ? objectBounds(sourceId) : null;
    const point = lineInteraction.preview;
    if (!sourceId || !source || !point || !isLineTool()) return null;

    const target = { x: point.x, y: point.y, width: 0, height: 0 };
    const circularSource = isBeacon(sourceId);
    const endpoints = shapeEndpoints(
      source,
      target,
      circularSource ? undefined : lineInteraction.sourceAnchor ?? undefined,
      undefined,
      circularSource,
      true,
    );
    const route = circularSource ? circleSource(endpoints, source) : endpoints;
    const geometry = buildShape(tool.lineShape, {
      ...route,
      sourceBounds: circularSource ? undefined : source,
    });
    const arrow = buildArrowGeometry(tool.lineShape, geometry);
    const requestedKind = previewLinkKind(tool.active);
    if (!requestedKind) return null;
    let hoveredId: string | null = null;
    const candidates = queryPoint(point);
    candidates.sort((first, second) => (orderIndex.get(second) ?? -1) - (orderIndex.get(first) ?? -1));
    for (const id of candidates) {
      const note = board.notes[id];
      if (!note) continue;
      const bounds = noteBounds(note);
      if (point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y && point.y <= bounds.y + bounds.height) {
        hoveredId = id;
        break;
      }
    }
    const kind = effectiveLinkKind(sourceId, hoveredId ?? "", requestedKind);
    const shapeDashes = kind === "weak" && (tool.lineShape === "wave" || tool.lineShape === "zigzag")
      ? buildShapeDashPaths(tool.lineShape, geometry, arrow.shaftLength)
      : [];
    return {
      path: arrow.shaftPath,
      headPath: arrow.headPath,
      dashPaths: shapeDashes.length > 0 ? shapeDashes : null,
      kind,
    };
  });

  onMount(() => {
    startSmoothLineSync();
    const parent = layer.parentElement;
    if (!parent) return;
    const surface: HTMLElement = parent;

    function localPoint(event: Pick<PointerEvent, "clientX" | "clientY">): Point {
      const rect = cachedClientRect(surface);
      return clientToBoardPoint({ x: event.clientX, y: event.clientY }, rect);
    }

    function worldPoint(event: Pick<PointerEvent, "clientX" | "clientY">): Point {
      return clientToWorld(
        { x: event.clientX, y: event.clientY },
        cachedClientRect(surface),
        camera,
        viewport,
      );
    }

    function objectAt(point: Point, preferredTarget: EventTarget | null): string | null {
      const target = preferredTarget instanceof Element ? preferredTarget : null;
      if (hasMeBeacon() && target?.closest(`[data-beacon-id="${ME_OBJECT_ID}"]`)) return ME_OBJECT_ID;
      const noteRoot = target?.closest<HTMLElement>("[data-note-id]");
      const directId = noteRoot?.dataset.noteId;
      if (directId && board.notes[directId]) return directId;

      const world = screenToWorld(camera, viewport, point);
      const beacon = objectBounds(ME_OBJECT_ID);
      if (beacon && world.x >= beacon.x && world.x <= beacon.x + beacon.width &&
        world.y >= beacon.y && world.y <= beacon.y + beacon.height) return ME_OBJECT_ID;
      const candidates = queryPoint(world);
      candidates.sort((first, second) => (orderIndex.get(second) ?? -1) - (orderIndex.get(first) ?? -1));
      for (const id of candidates) {
        const note = board.notes[id];
        if (!note) continue;
        const bounds = noteBounds(note);
        if (world.x >= bounds.x && world.x <= bounds.x + bounds.width &&
          world.y >= bounds.y && world.y <= bounds.y + bounds.height) return id;
      }
      return null;
    }

    function anchorAt(id: string, point: Point): LinkAnchor | undefined {
      if (isBeacon(id)) return undefined;
      const note = board.notes[id];
      return note ? projectPointToAnchor(noteBounds(note), screenToWorld(camera, viewport, point)) : undefined;
    }

    function linkAt(target: EventTarget | null): string | null {
      if (!(target instanceof Element)) return null;
      const id = target.closest<SVGGElement>("[data-link-id]")?.dataset.linkId;
      return id && links.byId[id] ? id : null;
    }

    function capturePointer(event: PointerEvent): void {
      if (isTextEditingTarget(event.target)) return;
      const point = localPoint(event);

      if (isLineTool() && event.button === 2) {
        lineInteraction.suppressContextMenuUntil = 0;
        const startLinkId = linkAt(event.target);
        activeCutLinkId = startLinkId;
        if (startLinkId) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        gesture = { kind: "cut", id: event.pointerId, start: point, startLinkId, captured: false };
        lineInteraction.cutStroke = [point];
        return;
      }

      if (event.button !== 0) return;

      if (isLineTool()) {
        const hitLinkId = linkAt(event.target);
        if (hitLinkId) {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelLineDraft();
          selectLinkUndoable(hitLinkId, event.ctrlKey || event.metaKey || event.shiftKey, true);
          lastBodyClick = null;
          return;
        }

        const objectId = objectAt(point, event.target);
        const noteBody = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-note-body]") : null;
        const now = performance.now();
        const isSecondBodyClick = Boolean(noteBody && objectId && (
          event.detail >= 2 || (lastBodyClick?.id === objectId && now - lastBodyClick.at <= 500)
        ));
        if (isSecondBodyClick) {
          tool.active = "select";
          cancelLineDraft();
          clearLinkSelectionUndoable();
          lastBodyClick = null;
          return;
        }

        if (!noteBody) event.preventDefault();
        event.stopImmediatePropagation();
        if (!objectId) {
          cancelLineDraft();
          gesture = { kind: "marquee", id: event.pointerId, start: point, captured: false };
          linkMarquee = { start: point, end: point };
          lastBodyClick = null;
          return;
        }

        const clickedAnchor = anchorAt(objectId, point);
        const draft: LinkDraft | null = lineInteraction.sourceId === null ? null : {
          sourceId: lineInteraction.sourceId,
          sourceAnchor: lineInteraction.sourceAnchor ?? undefined,
        };
        gesture = {
          kind: "link",
          id: event.pointerId,
          clickedId: objectId,
          clickedAnchor,
          draft,
          startedInBody: noteBody !== null,
          captured: false,
          start: point,
        };
        if (noteBody) {
          const noteRoot = noteBody.closest<HTMLElement>("[data-note-id]");
          if (noteRoot) {
            textSelectionElement = noteRoot;
            previousUserSelect = noteRoot.style.userSelect;
            noteRoot.style.userSelect = "none";
          }
        }
        if (!draft) {
          lineInteraction.sourceId = objectId;
          lineInteraction.sourceAnchor = clickedAnchor ?? null;
        }
        lineInteraction.preview = worldPoint(event);
        return;
      }

      const linkId = linkAt(event.target);
      if (linkId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        selectLinkUndoable(linkId, event.ctrlKey || event.metaKey || event.shiftKey, true);
        return;
      }
    }

    function onPointerMove(event: PointerEvent): void {
      const relevant = gesture?.id === event.pointerId ||
        (Boolean(lineInteraction.sourceId) && (tool.active === "line-strong" || tool.active === "line-weak"));
      if (!relevant) return;
      const point = localPoint(event);
      if (gesture?.id === event.pointerId) {
        if (!gesture.captured && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) >= CUT_DRAG_THRESHOLD_PX) {
          try {
            surface.setPointerCapture(event.pointerId);
            gesture.captured = true;
          } catch { /* Window handlers still track the gesture. */ }
        }
        if (gesture.kind === "cut") {
          const lastPoint = lineInteraction.cutStroke.at(-1);
          if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= 2) {
            lineInteraction.cutStroke = [...lineInteraction.cutStroke, point];
          }
        } else if (gesture.kind === "marquee") {
          linkMarquee = { start: gesture.start, end: point };
        } else {
          lineInteraction.preview = worldPoint(event);
        }
      } else if (lineInteraction.sourceId && (tool.active === "line-strong" || tool.active === "line-weak")) {
        lineInteraction.preview = worldPoint(event);
      }
    }

    function tryCreate(
      fromId: string,
      toId: string,
      fromAnchor: LinkAnchor | undefined,
      toAnchor: LinkAnchor | undefined,
      point: Point,
    ): boolean {
      if (toId === ME_OBJECT_ID) {
        setLineError(t("Beacons can have outgoing links only"), point);
        lineInteraction.sourceId = fromId;
        lineInteraction.sourceAnchor = fromAnchor ?? null;
        return false;
      }
      if (fromId === toId) {
        setLineError(t("An object cannot link to itself"), point);
        lineInteraction.sourceId = fromId;
        lineInteraction.sourceAnchor = fromAnchor ?? null;
        return false;
      }
      const kind = effectiveLinkKind(fromId, toId, tool.active === "line-weak" ? "weak" : "strong");
      const refusal = linkRefusalReason(fromId, toId, kind);
      if (refusal || !canLink(fromId, toId, kind)) {
        setLineError(refusal ?? t("Could not create link"), point);
        lineInteraction.sourceId = fromId;
        lineInteraction.sourceAnchor = fromAnchor ?? null;
        return false;
      }
      const link: Link = {
        id: newId(),
        from: fromId,
        to: toId,
        kind,
        shape: tool.lineShape,
        ...(fromAnchor ? { fromAnchor } : {}),
        ...(toAnchor ? { toAnchor } : {}),
      };
      if (!createBoardLink(link)) {
        setLineError(t("Could not create link"), point);
        lineInteraction.sourceId = fromId;
        lineInteraction.sourceAnchor = fromAnchor ?? null;
        return false;
      }
      cancelLineDraft();
      return true;
    }

    // Links outside the beacon focus are not interactive (M060), including for cut and marquee.
    function isLinkDimmed(id: string): boolean {
      const link = links.byId[id];
      return !!link && (isDimmed(link.from) || isDimmed(link.to));
    }

    function finishCut(active: Extract<PointerGesture, { kind: "cut" }>, point: Point): void {
      const stroke = [...lineInteraction.cutStroke];
      const last = stroke.at(-1);
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1) stroke.push(point);
      lineInteraction.cutStroke = [];

      const dragged = Math.hypot(point.x - active.start.x, point.y - active.start.y) >= CUT_DRAG_THRESHOLD_PX;
      lineInteraction.suppressContextMenuUntil = shouldSuppressLineCutContextMenu(
        isLineTool(), dragged, active.startLinkId,
      ) ? performance.now() + 750 : 0;
      const release = resolveCutRelease(dragged, active.startLinkId);
      if (release === "cut-link") {
        if (active.startLinkId) cutLinks([active.startLinkId]);
        return;
      }
      if (release !== "cut-stroke") return;

      const worldStroke = stroke.map((screenPoint) => screenToWorld(camera, viewport, screenPoint));
      const tolerance = CUT_TOLERANCE_PX / (PX_PER_UNIT * camera.zoom);
      const crossed = renderedLinks
        .filter((link) => !isLinkDimmed(link.id))
        .filter((link) => strokeIntersectsPath(worldStroke, { type: "polyline", points: link.geometry.polyline }, tolerance))
        .map((link) => link.id);
      if (crossed.length > 0) cutLinks(crossed);
    }

    function finishMarquee(active: Extract<PointerGesture, { kind: "marquee" }>, point: Point, event: PointerEvent): void {
      linkMarquee = null;
      const dragged = Math.hypot(point.x - active.start.x, point.y - active.start.y) >= CUT_DRAG_THRESHOLD_PX;
      if (!dragged) {
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          const current = captureSelectionSnapshot();
          setSelectionUndoable({ ...current, ids: [], zoneIds: [], primaryId: null });
        } else {
          clearLinkSelectionUndoable(true);
        }
        return;
      }

      const first = screenToWorld(camera, viewport, active.start);
      const last = screenToWorld(camera, viewport, point);
      const touched = renderedLinks
        .filter((link) => !isLinkDimmed(link.id))
        .filter((link) => marqueeIntersectsPath({
          x: first.x,
          y: first.y,
          width: last.x - first.x,
          height: last.y - first.y,
        }, { type: "polyline", points: link.geometry.polyline }))
        .map((link) => link.id);
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      selectLinksUndoable(touched, additive, true);
    }

    function finishPointer(event: PointerEvent): void {
      if (!gesture || gesture.id !== event.pointerId) return;
      const active = gesture;
      gesture = null;
      activeCutLinkId = null;
      restoreTextSelection();
      const point = localPoint(event);

      if (!isLineTool()) {
        linkMarquee = null;
        cancelLineDraft();
        return;
      }

      if (active.kind === "cut") {
        finishCut(active, point);
        return;
      }
      if (active.kind === "marquee") {
        finishMarquee(active, point, event);
        cancelLineDraft();
        return;
      }

      const moved = Math.hypot(point.x - active.start.x, point.y - active.start.y) > 5;
      const targetId = objectAt(point, event.target);
      const result = completeLinkGesture({
        draft: active.draft,
        clickedId: active.clickedId,
        clickedAnchor: active.clickedAnchor,
        moved,
        targetId,
        targetAnchor: targetId ? anchorAt(targetId, point) : undefined,
      });

      if (result.kind === "start") {
        lineInteraction.sourceId = result.draft.sourceId;
        lineInteraction.sourceAnchor = result.draft.sourceAnchor ?? null;
        lineInteraction.preview = worldPoint(event);
        lastBodyClick = active.startedInBody ? { id: active.clickedId, at: performance.now() } : null;
      } else if (result.kind === "create") {
        lastBodyClick = null;
        tryCreate(result.from, result.to, result.fromAnchor, result.toAnchor, point);
      } else {
        lastBodyClick = null;
        cancelLineDraft();
      }
    }

    function onPointerCancel(event: PointerEvent): void {
      if (!gesture || gesture.id !== event.pointerId) return;
      gesture = null;
      activeCutLinkId = null;
      linkMarquee = null;
      restoreTextSelection();
      cancelLineDraft();
    }

    function onContextMenu(event: MouseEvent): void {
      if (!isLineTool() || !surface.contains(event.target as Node | null)) return;
      if (performance.now() >= lineInteraction.suppressContextMenuUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function restoreTextSelection(): void {
      if (!textSelectionElement) return;
      textSelectionElement.style.userSelect = previousUserSelect;
      textSelectionElement = null;
      previousUserSelect = "";
    }

    surface.addEventListener("pointerdown", capturePointer, true);
    surface.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", finishPointer, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    surface.addEventListener("lostpointercapture", onPointerCancel, true);
    return () => {
      cancelLineDraft();
      restoreTextSelection();
      surface.removeEventListener("pointerdown", capturePointer, true);
      surface.removeEventListener("contextmenu", onContextMenu, true);
      surface.removeEventListener("lostpointercapture", onPointerCancel, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", finishPointer, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
    };
  });

  function geometryForLink(link: Link, source: Bounds, target: Bounds): ShapeResult {
    const circularSource = isBeacon(link.from);
    const circularTarget = isBeacon(link.to);
    const endpoints = resolveLinkEndpoints(
      source,
      target,
      link.fromAnchor,
      link.toAnchor,
      circularSource,
      circularTarget,
    );
    return buildShape(link.shape, {
      ...endpoints,
      sourceBounds: circularSource ? undefined : source,
      targetBounds: circularTarget ? undefined : target,
    });
  }

  function sameLinkRenderInputs(
    cache: LinkRenderCache,
    link: Link,
    source: Bounds,
    target: Bounds,
    fromColor: string,
    toColor: string,
    _selected: boolean,
  ): boolean {
    return cache.link === link && cache.from === link.from && cache.to === link.to &&
      cache.kind === link.kind && cache.shape === link.shape &&
      cache.fromAnchor === anchorKey(link.fromAnchor) && cache.toAnchor === anchorKey(link.toAnchor) &&
      sameBounds(cache.source, source) && sameBounds(cache.target, target) &&
      cache.fromColor === fromColor && cache.toColor === toColor;
  }

  function sameBounds(first: Bounds, second: Bounds): boolean {
    return first.x === second.x && first.y === second.y &&
      first.width === second.width && first.height === second.height;
  }

  function anchorKey(anchor: LinkAnchor | undefined): string {
    return anchor ? `${anchor.x},${anchor.y}` : "";
  }

  function circleSource(endpoints: ReturnType<typeof shapeEndpoints>, bounds: Bounds): ReturnType<typeof shapeEndpoints> {
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const source = pointOnCircleToward(center, BEACON_SIZE / 2, endpoints.end);
    return { ...endpoints, start: source.point, startNormal: source.normal };
  }

  function isBeacon(id: string): boolean {
    return id === ME_OBJECT_ID ? hasMeBeacon() : board.notes[id]?.type === "beacon";
  }

  function objectBounds(id: string): Bounds | null {
    if (id === ME_OBJECT_ID) {
      if (!hasMeBeacon()) return null;
      return { x: ME_POSITION.x - ME_RADIUS, y: ME_POSITION.y - ME_RADIUS, width: ME_RADIUS * 2, height: ME_RADIUS * 2 };
    }
    const note = board.notes[id];
    return note ? noteBounds(note) : null;
  }

  function safeId(value: string): string {
    return [...value].map((character) => /^[a-z\d_-]$/i.test(character)
      ? character
      : `_${character.codePointAt(0)?.toString(16) ?? "0"}_`).join("");
  }

  function lineStrokeWidth(kind: Link["kind"], selected: boolean): number {
    const base = selected ? 0.3 : kind === "weak" ? 0.2 : 0.25;
    const minimumForOnePixel = 1 / (PX_PER_UNIT * Math.max(camera.zoom, 0.01));
    return Math.max(base, minimumForOnePixel);
  }
</script>

<div class="links-layer" bind:this={layer}>
  <div class="links-world">
    <svg class="links-svg" width="100%" height="100%" aria-hidden="true">
      <g transform={worldTransform}>
      <defs>
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
        {@const model = links.byId[link.id]}
        {@const focusedIds = visibleInFocus()}
        {@const detailed = lod.tier === "full" || link.selected || Boolean(model && focusedIds?.has(model.from) && focusedIds?.has(model.to))}
        <g role="group" data-link-id={link.id} class:selected={link.selected} class:dimmed={isDimmed(model?.from ?? "") || isDimmed(model?.to ?? "")}
          onpointerenter={() => { hoveredLinkId = link.id; }} onpointerleave={() => { if (hoveredLinkId === link.id) hoveredLinkId = null; }}>
          <path class="link-hit" d={link.path} />
          {#if detailed && link.dashPaths}
            {#each link.dashPaths as dashPath, index (`${link.id}-dash-${index}`)}
              <path
                class="link-line custom-dashes"
                class:weak={link.kind === "weak"}
                d={dashPath}
                style:stroke={link.selected ? "var(--accent)" : detailed && link.gradient ? `url(#${link.gradient.id})` : undefined}
                style:stroke-width={lineStrokeWidth(link.kind, link.selected)}
              />
            {/each}
          {:else}
            <path
              class="link-line"
              class:weak={detailed && link.kind === "weak"}
              d={detailed ? link.shaftPath : link.path}
              style:stroke={link.selected ? "var(--accent)" : detailed && link.gradient ? `url(#${link.gradient.id})` : undefined}
              style:stroke-width={lineStrokeWidth(link.kind, link.selected)}
            />
          {/if}
          {#if detailed && link.headPath}
            <path
              class="link-arrow"
              class:weak={link.kind === "weak"}
              d={link.headPath}
              style:fill={link.selected ? "var(--accent)" : link.gradient ? link.gradient.toColor : undefined}
            />
          {/if}
        </g>
      {/each}
      {#if previewLink}
        {#if previewLink.dashPaths}
          {#each previewLink.dashPaths as dashPath, index (`preview-dash-${index}`)}
            <path
              class="link-line link-preview custom-dashes"
              class:weak={previewLink.kind === "weak"}
              d={dashPath}
              style:stroke-width={lineStrokeWidth(previewLink.kind, false)}
            />
          {/each}
        {:else}
          <path
            class="link-line link-preview"
            class:weak={previewLink.kind === "weak"}
            d={previewLink.path}
            style:stroke-width={lineStrokeWidth(previewLink.kind, false)}
          />
        {/if}
        {#if previewLink.headPath}
          <path class="link-arrow link-preview" class:weak={previewLink.kind === "weak"} d={previewLink.headPath} />
        {/if}
      {/if}
      </g>
    </svg>
  </div>
  {#if lineInteraction.cutStroke.length > 1}
    <svg class="cut-preview" data-selection-ignore width="100%" height="100%" aria-hidden="true">
      <polyline points={lineInteraction.cutStroke.map((point) => `${point.x},${point.y}`).join(" ")} />
    </svg>
  {/if}
  {#if linkMarquee}
    <div
      class="link-selection-marquee"
      data-selection-ignore
      style:left="{Math.min(linkMarquee.start.x, linkMarquee.end.x)}px"
      style:top="{Math.min(linkMarquee.start.y, linkMarquee.end.y)}px"
      style:width="{Math.abs(linkMarquee.end.x - linkMarquee.start.x)}px"
      style:height="{Math.abs(linkMarquee.end.y - linkMarquee.start.y)}px"
    ></div>
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
    pointer-events: none;
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
    stroke-width: 0.25px;
    pointer-events: none;
  }

  .link-line.weak {
    stroke-width: 0.2px;
    stroke-dasharray: 2.4 1.2;
    opacity: 0.88;
  }

  .link-line.custom-dashes {
    stroke-dasharray: none;
    stroke-linecap: round;
  }

  .link-line.link-preview {
    stroke: color-mix(in srgb, var(--accent) 75%, #ffffff);
    opacity: 0.85;
  }

  .link-line.link-preview.custom-dashes {
    stroke-dasharray: none;
  }

  .link-preview.weak {
    stroke: #a1b6bd;
  }

  .selected .link-line {
    stroke: var(--accent);
    stroke-width: 0.3px;
  }

  .link-arrow {
    fill: #a9a294;
    pointer-events: none;
  }

  .link-arrow.weak {
    fill: #a1b6bd;
    opacity: 0.88;
  }

  .link-arrow.link-preview {
    fill: color-mix(in srgb, var(--accent) 75%, #ffffff);
  }

  .link-arrow.link-preview.weak {
    fill: #a1b6bd;
  }

  .cut-preview {
    position: absolute;
    z-index: 40;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }

  .link-selection-marquee {
    position: absolute;
    z-index: 39;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    pointer-events: none;
  }

  .cut-preview polyline {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2px;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .line-error {
    position: absolute;
    z-index: 41;
    box-sizing: border-box;
    width: max-content;
    max-width: min(280px, calc(100vw - 16px));
    padding: 4px 7px;
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--bg-panel));
    border-radius: 3px;
    color: var(--text);
    background: rgba(35, 32, 25, 0.96);
    font-size: 11px;
    line-height: 1.3;
    overflow-wrap: anywhere;
    white-space: normal;
    pointer-events: none;
  }
</style>
