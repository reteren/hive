<script lang="ts">
  import { onMount } from "svelte";
  import { camera, viewport } from "./camera.svelte";
  import { lod, queryRect, visible, viewportWorldRect } from "./visibility.svelte";
  import { PX_PER_UNIT } from "./cameraMath";
  import { attachmentUrl } from "../attachments/service";
  import { acquireDisplayBitmap, displayBitmapSize, peekCachedDisplayBitmap, type DisplayBitmapLease } from "../attachments/displayBitmap";
  import { linkRouteIndex, routeBounds } from "../links/routeIndex";
  import { links, linksOf, onLinksMutation } from "../model/links.svelte";
  import { board, onBoardMutation } from "../model/board.svelte";
  import { onZonesMutation, zones } from "../model/zones.svelte";
  import { noteBounds } from "../notes/layout.svelte";
  import { editing } from "../notes/editing.svelte";
  import { selection } from "../selection/selection.svelte";
  import { selectedLinkIds } from "../links/selection.svelte";
  import { visibleInFocus } from "../beacons/focus.svelte";
  import { zoneIdsInRect } from "../zones/membership.svelte";
  import { zoneMovePreview } from "../zones/zoneMovePreview.svelte";
  import { buildFarDrawList, paintFarDrawListWorld, paintFarLinks, type FarDrawList, type FarLinkItem } from "./farDrawList";
  import { FarTileCache, farTileKey, farTilesForRect, farZoomBucket } from "./farTileCache";
  import type { Rect } from "./spatialIndex";

  const TILE_SIZE = 512;
  const TILE_PREFETCH = 1;
  const MAX_CACHED_TILES = 72;
  const MAX_IMAGE_DRAWS_PER_TILE = 32;
  const MAX_IMAGE_RESOLUTIONS = 256;
  const GESTURE_IDLE_MS = 120;

  interface CachedTile {
    canvas: HTMLCanvasElement;
    list: FarDrawList;
  }

  interface CachedImage {
    key: string;
    url: string;
    bitmap?: CanvasImageSource;
    lease?: DisplayBitmapLease;
    pendingToken?: symbol;
  }

  let canvas: HTMLCanvasElement;
  let frame: number | null = null;
  let gestureIdleTimer: number | null = null;
  let disposed = false;
  let noteOrder = new Map(board.order.map((id, index) => [id, index]));
  let previousTier = lod.tier;
  let cacheBucket: number | null = null;
  const cachePixelRatio = 1;
  let tileWorldSize = 0;
  let movingNoteIds = new Set<string>();
  let dynamicLinkIds = new Set<string>();
  let previousSelectedNotes = new Set<string>();
  let previousSelectedZones = new Set<string>();
  let previousSelectedLinks = new Set<string>();
  let previousFocused: ReadonlySet<string> | null = visibleInFocus();
  let previousMoveZoneId: string | null = zoneMovePreview.zoneId;
  const tiles = new FarTileCache<CachedTile>();
  const imageResolutions = new Map<string, CachedImage>();
  const failedImages = new Map<string, string>();
  let imageLoadsInFlight = 0;

  function scheduleFrame(): void {
    if (disposed || frame !== null || lod.tier !== "min" || typeof requestAnimationFrame === "undefined") return;
    frame = requestAnimationFrame(paintFrame);
  }

  function paintFrame(): void {
    frame = null;
    if (lod.tier !== "min" || viewport.width <= 0 || viewport.height <= 0 || !canvas) return;

    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(viewport.width * pixelRatio));
    const height = Math.max(1, Math.round(viewport.height * pixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;

    const bucket = farZoomBucket(camera.zoom);
    if (cacheBucket !== bucket) {
      clearTiles();
      clearImageResolutions();
      cacheBucket = bucket;
      tileWorldSize = TILE_SIZE / (bucket * PX_PER_UNIT);
    }
    if (!(tileWorldSize > 0)) return;

    const view = viewportWorldRect(0);
    const padded: Rect = {
      x: view.x - tileWorldSize * TILE_PREFETCH,
      y: view.y - tileWorldSize * TILE_PREFETCH,
      width: view.width + tileWorldSize * TILE_PREFETCH * 2,
      height: view.height + tileWorldSize * TILE_PREFETCH * 2,
    };
    const requested = farTilesForRect(padded, tileWorldSize);
    const requestedKeys = new Set(requested.map(({ x, y }) => farTileKey(x, y)));
    let addedTile = false;

    const dynamicLinks = dynamicLinksForFrame(view);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);
    const scale = camera.zoom * PX_PER_UNIT;
    context.setTransform(
      pixelRatio * scale,
      0,
      0,
      pixelRatio * scale,
      pixelRatio * (viewport.width / 2 - camera.x * scale),
      pixelRatio * (viewport.height / 2 - camera.y * scale),
    );
    paintFarLinks(context, dynamicLinks, scale);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    for (const { x, y } of requested) {
      let tile = tiles.get(x, y)?.value;
      if (!tile) {
        tile = buildTile(x, y, bucket);
        addedTile = true;
      }
      const worldX = x * tileWorldSize;
      const worldY = y * tileWorldSize;
      const screenX = viewport.width / 2 + (worldX - camera.x) * scale;
      const screenY = viewport.height / 2 + (worldY - camera.y) * scale;
      const screenSize = tileWorldSize * scale;
      context.drawImage(tile.canvas, screenX, screenY, screenSize, screenSize);
    }
    if (addedTile && tiles.size > MAX_CACHED_TILES) disposeTiles(tiles.retain(requestedKeys, MAX_CACHED_TILES));
  }

  function buildTile(tileX: number, tileY: number, bucket: number): CachedTile {
    const rect: Rect = {
      x: tileX * tileWorldSize,
      y: tileY * tileWorldSize,
      width: tileWorldSize,
      height: tileWorldSize,
    };
    const focused = visibleInFocus();
    const selectedNotes = selectedNoteIds(focused);
    for (const id of movingNoteIds) selectedNotes.add(id);
    const list = buildFarDrawList({
      noteIds: queryRect(rect),
      notes: board.notes,
      noteOrder,
      noteBounds,
      selectedNoteIds: selectedNotes,
      focusedObjectIds: focused,
      selectedZoneIds: selectedZoneIds(),
      selectedLinkIds: new Set(selectedLinkIds()),
      excludedLinkIds: dynamicLinkIds,
      zoneIds: zoneIdsInRect(rect),
      zones: zones.byId,
      linkIds: linkRouteIndex.query(rect),
      links: links.byId,
      routePoints: (id) => linkRouteIndex.pointsOf(id),
    });
    const imageBitmaps = imageBitmapsForTile(list, rect, bucket);
    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = Math.round(TILE_SIZE * cachePixelRatio);
    tileCanvas.height = Math.round(TILE_SIZE * cachePixelRatio);
    const tileContext = tileCanvas.getContext("2d");
    if (tileContext) {
      const scale = bucket * PX_PER_UNIT;
      tileContext.setTransform(
        cachePixelRatio * scale,
        0,
        0,
        cachePixelRatio * scale,
        -cachePixelRatio * rect.x * scale,
        -cachePixelRatio * rect.y * scale,
      );
      paintFarDrawListWorld(tileContext, list, imageBitmaps, scale);
    }
    const entry = tiles.set(tileX, tileY, rect, { canvas: tileCanvas, list }, {
      noteIds: list.notes.concat(list.beacons).map((item) => item.id),
      linkIds: list.links.map((item) => item.id),
      zoneIds: list.zones.map((item) => item.id),
    });
    return entry.value;
  }

  function imageBitmapsForTile(list: FarDrawList, tileRect: Rect, bucket: number): Map<string, CanvasImageSource> {
    const result = new Map<string, CanvasImageSource>();
    const screen = viewportWorldRect(0);
    let imageDraws = 0;
    for (const item of list.notes) {
      if (item.kind !== "image" || imageDraws >= MAX_IMAGE_DRAWS_PER_TILE) continue;
      imageDraws += 1;
      const bitmap = resolveImage(item.id, item.width, item.height, bucket, tileRect, screen);
      if (bitmap) result.set(item.id, bitmap);
    }
    return result;
  }

  function resolveImage(
    id: string,
    noteWidth: number,
    noteHeight: number,
    bucket: number,
    tileRect: Rect,
    screen: Rect,
  ): CanvasImageSource | undefined {
    const image = board.notes[id]?.image;
    if (!image) return undefined;
    const url = attachmentUrl(image.file);
    if (!url) return undefined;
    const displayed = displayBitmapSize(
      image.naturalWidth,
      image.naturalHeight,
      noteWidth * bucket * PX_PER_UNIT * cachePixelRatio,
      noteHeight * bucket * PX_PER_UNIT * cachePixelRatio,
      1,
    );
    const key = `${url}:${displayed.width}x${displayed.height}`;
    let resolution = imageResolutions.get(id);
    if (resolution?.key === key) {
      if (resolution.bitmap || resolution.pendingToken || failedImages.get(id) === key) return resolution.bitmap;
    } else {
      if (failedImages.get(id) === key) return undefined;
      failedImages.delete(id);
      resolution?.lease?.release();
      imageResolutions.delete(id);
      if (imageResolutions.size >= MAX_IMAGE_RESOLUTIONS) return undefined;

      const cached = peekCachedDisplayBitmap(url, displayed.width, displayed.height);
      if (cached) {
        imageResolutions.set(id, { key, url, bitmap: cached });
        return cached;
      }
      resolution = { key, url };
      imageResolutions.set(id, resolution);
    }

    if (resolution && imageLoadsInFlight < 2 && !failedImages.has(id) && rectsIntersect(tileRect, screen)) {
      const token = Symbol(id);
      resolution.pendingToken = token;
      const pending = resolution;
      imageLoadsInFlight += 1;
      void acquireDisplayBitmap(url, displayed.width, displayed.height).then((lease) => {
        imageLoadsInFlight = Math.max(0, imageLoadsInFlight - 1);
        const currentImage = board.notes[id]?.image;
        if (imageResolutions.get(id) !== pending || pending.pendingToken !== token ||
          !currentImage || attachmentUrl(currentImage.file) !== url) {
          lease.release();
          scheduleFrame();
          return;
        }
        pending.pendingToken = undefined;
        pending.bitmap = lease.bitmap;
        pending.lease = lease;
        disposeTiles(tiles.invalidateObject("note", id));
        scheduleFrame();
      }).catch(() => {
        imageLoadsInFlight = Math.max(0, imageLoadsInFlight - 1);
        if (imageResolutions.get(id) === pending && pending.pendingToken === token) {
          pending.pendingToken = undefined;
          failedImages.set(id, key);
          while (failedImages.size > MAX_IMAGE_RESOLUTIONS) {
            const oldest = failedImages.keys().next().value;
            if (oldest === undefined) break;
            failedImages.delete(oldest);
          }
        }
        scheduleFrame();
      });
    }
    return resolution?.bitmap;
  }

  function dynamicLinksForFrame(view: Rect): FarLinkItem[] {
    if (movingNoteIds.size === 0) return [];
    const focused = visibleInFocus();
    const result = new Map<string, FarLinkItem>();
    for (const noteId of movingNoteIds) {
      for (const link of linksOf(noteId)) {
        const points = linkRouteIndex.pointsOf(link.id);
        const bounds = points && routeBounds(points);
        if (!points || points.length < 2 || !bounds || !rectsIntersect(bounds, view)) continue;
        const dimmed = focused && (!focused.has(link.from) || !focused.has(link.to));
        result.set(link.id, { id: link.id, kind: link.kind, points, opacity: dimmed ? 0.3 : 1 });
      }
    }
    return [...result.values()];
  }

  function beginMovingNote(id: string): void {
    if (movingNoteIds.has(id)) return;
    movingNoteIds.add(id);
    refreshDynamicLinks();
    resetGestureIdleTimer();
  }

  function refreshDynamicLinks(): void {
    const next = new Set<string>();
    for (const noteId of movingNoteIds) for (const link of linksOf(noteId)) next.add(link.id);
    for (const id of dynamicLinkIds) if (!next.has(id)) invalidateLink(id);
    for (const id of next) if (!dynamicLinkIds.has(id)) invalidateLink(id);
    dynamicLinkIds = next;
  }

  function resetGestureIdleTimer(): void {
    if (gestureIdleTimer !== null) window.clearTimeout(gestureIdleTimer);
    gestureIdleTimer = window.setTimeout(() => {
      gestureIdleTimer = null;
      const finishedNotes = [...movingNoteIds];
      movingNoteIds.clear();
      const finishedLinks = [...dynamicLinkIds];
      dynamicLinkIds.clear();
      for (const id of finishedNotes) invalidateNote(id);
      for (const id of finishedLinks) invalidateLink(id);
      scheduleFrame();
    }, GESTURE_IDLE_MS);
  }

  function onBoardChanged(ids: readonly string[] | null): void {
    if (ids === null) {
      rebuildNoteOrder();
      clearTiles();
      clearImageResolutions();
      scheduleFrame();
      return;
    }
    const selected = selectedNoteIds(visibleInFocus());
    let orderChanged = false;
    for (const id of ids) {
      const note = board.notes[id];
      if (!note || !noteOrder.has(id)) orderChanged = true;
      if (note && selected.has(id)) {
        beginMovingNote(id);
        continue;
      }
      invalidateNote(id);
      const resolution = imageResolutions.get(id);
      if (resolution && (!note?.image || attachmentUrl(note.image.file) !== resolution.url)) {
        resolution.lease?.release();
        imageResolutions.delete(id);
      }
      if (!note) failedImages.delete(id);
    }
    if (orderChanged) {
      rebuildNoteOrder();
      clearTiles();
    }
    scheduleFrame();
  }

  function onLinksChanged(ids: readonly string[] | null, topologyChanged: boolean): void {
    if (ids === null) {
      clearTiles();
      if (movingNoteIds.size > 0) refreshDynamicLinks();
      scheduleFrame();
      return;
    }
    if (topologyChanged && movingNoteIds.size > 0) refreshDynamicLinks();
    for (const id of ids) if (!dynamicLinkIds.has(id)) invalidateLink(id);
    scheduleFrame();
  }

  function onZonesChanged(ids: readonly string[] | null): void {
    if (ids === null) clearTiles();
    else for (const id of ids) invalidateZone(id);
    scheduleFrame();
  }

  function invalidateNote(id: string): void {
    disposeTiles(tiles.invalidateObject("note", id));
    const note = board.notes[id];
    if (note) disposeTiles(tiles.invalidateRect(noteBounds(note), tileWorldSize));
  }

  function invalidateLink(id: string): void {
    disposeTiles(tiles.invalidateObject("link", id));
    const points = linkRouteIndex.pointsOf(id);
    const bounds = points && routeBounds(points);
    if (bounds) disposeTiles(tiles.invalidateRect(bounds, tileWorldSize));
  }

  function invalidateZone(id: string): void {
    disposeTiles(tiles.invalidateObject("zone", id));
    const zone = zones.byId[id];
    const bounds = zone && zoneRect(zone.parts.flat().concat(zone.holes.flat()));
    if (bounds) disposeTiles(tiles.invalidateRect(bounds, tileWorldSize));
  }

  function onSelectionChanged(): void {
    const focused = visibleInFocus();
    const selectedNotes = selectedNoteIds(focused);
    for (const id of changedIds(previousSelectedNotes, selectedNotes)) invalidateNote(id);
    const selectedZones = new Set(selection.zoneIds);
    if (zoneMovePreview.zoneId) selectedZones.add(zoneMovePreview.zoneId);
    for (const id of changedIds(previousSelectedZones, selectedZones)) invalidateZone(id);
    const selectedLinks = new Set(selectedLinkIds());
    for (const id of changedIds(previousSelectedLinks, selectedLinks)) invalidateLink(id);
    if ((previousFocused === null) !== (focused === null)) clearTiles();
    else if (focused) {
      for (const id of changedIds(previousFocused ?? new Set(), focused)) {
        invalidateNote(id);
        for (const link of linksOf(id)) invalidateLink(link.id);
      }
    }
    if (previousMoveZoneId !== zoneMovePreview.zoneId) {
      if (previousMoveZoneId) invalidateZone(previousMoveZoneId);
      if (zoneMovePreview.zoneId) invalidateZone(zoneMovePreview.zoneId);
    }
    previousSelectedNotes = selectedNotes;
    previousSelectedZones = selectedZones;
    previousSelectedLinks = selectedLinks;
    previousFocused = focused ? new Set(focused) : null;
    previousMoveZoneId = zoneMovePreview.zoneId;
    scheduleFrame();
  }

  function selectedNoteIds(focused: ReadonlySet<string> | null): Set<string> {
    const selected = new Set(selection.ids);
    if (editing.noteId) selected.add(editing.noteId);
    if (focused) for (const id of focused) selected.add(id);
    return selected;
  }

  function selectedZoneIds(): Set<string> {
    const selected = new Set(selection.zoneIds);
    if (zoneMovePreview.zoneId) selected.add(zoneMovePreview.zoneId);
    return selected;
  }

  function rebuildNoteOrder(): void {
    noteOrder = new Map(board.order.map((id, index) => [id, index]));
  }

  function clearTiles(): void {
    disposeTiles(tiles.clear());
  }

  function disposeTiles(entries: Array<{ value: CachedTile }>): void {
    for (const entry of entries) {
      entry.value.canvas.width = 0;
      entry.value.canvas.height = 0;
    }
  }

  function clearImageResolutions(): void {
    for (const { lease } of imageResolutions.values()) lease?.release();
    imageResolutions.clear();
    failedImages.clear();
  }

  onMount(() => {
    const stopBoard = onBoardMutation(onBoardChanged);
    const stopLinks = onLinksMutation(onLinksChanged);
    const stopZones = onZonesMutation(onZonesChanged);
    scheduleFrame();
    return () => {
      disposed = true;
      stopBoard();
      stopLinks();
      stopZones();
      clearTiles();
      clearImageResolutions();
      if (gestureIdleTimer !== null) window.clearTimeout(gestureIdleTimer);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  });

  $effect.root(() => {
    $effect(() => {
      const tier = lod.tier;
      void visible.rect.x;
      void visible.rect.y;
      void visible.rect.width;
      void visible.rect.height;
      void camera.x;
      void camera.y;
      void camera.zoom;
      void viewport.width;
      void viewport.height;
      if (tier !== previousTier) {
        previousTier = tier;
        clearTiles();
        if (tier !== "min") clearImageResolutions();
      }
      scheduleFrame();
    });

    $effect(() => {
      void selection.ids;
      void selection.zoneIds;
      void editing.noteId;
      void selectedLinkIds();
      void visibleInFocus();
      void zoneMovePreview.zoneId;
      onSelectionChanged();
    });
  });

  function changedIds(first: ReadonlySet<string>, second: ReadonlySet<string>): Set<string> {
    const changed = new Set<string>();
    for (const id of first) if (!second.has(id)) changed.add(id);
    for (const id of second) if (!first.has(id)) changed.add(id);
    return changed;
  }

  function rectsIntersect(first: Rect, second: Rect): boolean {
    return first.x <= second.x + second.width && second.x <= first.x + first.width &&
      first.y <= second.y + second.height && second.y <= first.y + first.height;
  }

  function zoneRect(points: readonly { x: number; y: number }[]): Rect | null {
    if (points.length === 0) return null;
    let left = points[0]!.x;
    let right = left;
    let top = points[0]!.y;
    let bottom = top;
    for (const point of points) {
      left = Math.min(left, point.x);
      right = Math.max(right, point.x);
      top = Math.min(top, point.y);
      bottom = Math.max(bottom, point.y);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
</script>

<canvas class="far-layer" bind:this={canvas} aria-hidden="true" style:display={lod.tier === "min" ? "block" : "none"}></canvas>

<style>
  .far-layer {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
