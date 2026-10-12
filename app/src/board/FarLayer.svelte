<script lang="ts">
  import { onMount } from "svelte";
  import { camera, viewport } from "./camera.svelte";
  import { lod, queryRect, visible, viewportWorldRect } from "./visibility.svelte";
  import { PX_PER_UNIT } from "./cameraMath";
  import { attachmentUrl } from "../attachments/service";
  import { acquireDisplayBitmap, displayBitmapSize, peekCachedDisplayBitmap, type DisplayBitmapLease } from "../attachments/displayBitmap";
  import { linkRouteIndex } from "../links/routeIndex";
  import { links, onLinksMutation } from "../model/links.svelte";
  import { board, onBoardMutation } from "../model/board.svelte";
  import { onZonesMutation, zones } from "../model/zones.svelte";
  import { noteBounds } from "../notes/layout.svelte";
  import { editing } from "../notes/editing.svelte";
  import { selection } from "../selection/selection.svelte";
  import { selectedLinkIds } from "../links/selection.svelte";
  import { visibleInFocus } from "../beacons/focus.svelte";
  import { zoneIdsInRect } from "../zones/membership.svelte";
  import { zoneMovePreview } from "../zones/zoneMovePreview.svelte";
  import { buildFarDrawList, paintFarDrawList, type FarDrawList } from "./farDrawList";
  import type { Rect } from "./spatialIndex";

  let canvas: HTMLCanvasElement;
  let drawList: FarDrawList | null = null;
  let drawListDirty = true;
  let frame: number | null = null;
  let disposed = false;
  let noteOrder = new Map(board.order.map((id, index) => [id, index]));
  let previousTier = lod.tier;
  let previousRect: Rect | null = null;
  let previousSelected = new Set<string>();
  let previousSelectedZones = new Set<string>();
  let previousSelectedLinks = new Set<string>();
  let previousMoveZoneId: string | null = zoneMovePreview.zoneId;
  const imageLeases = new Map<string, { url: string; lease: DisplayBitmapLease }>();
  const pendingImages = new Map<string, { url: string; token: symbol }>();
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

    if (drawListDirty || !drawList) {
      const focused = visibleInFocus();
      const selectedNotes = new Set(selection.ids);
      if (editing.noteId) selectedNotes.add(editing.noteId);
      if (focused) for (const id of focused) selectedNotes.add(id);
      drawList = buildFarDrawList({
        noteIds: queryRect(visible.rect),
        notes: board.notes,
        noteOrder,
        noteBounds,
        selectedNoteIds: selectedNotes,
        focusedObjectIds: focused,
        selectedZoneIds: new Set([...previousSelectedZones, ...(zoneMovePreview.zoneId ? [zoneMovePreview.zoneId] : [])]),
        selectedLinkIds: previousSelectedLinks,
        zoneIds: zoneIdsInRect(visible.rect),
        zones: zones.byId,
        linkIds: linkRouteIndex.query(visible.rect),
        links: links.byId,
        routePoints: (id) => linkRouteIndex.pointsOf(id),
      });
      releaseImagesOutsideDrawList(drawList);
      drawListDirty = false;
    }
    paintFarDrawList(context, drawList, camera, viewport, pixelRatio, imageBitmapsForFrame(drawList, pixelRatio));
  }

  function releaseImagesOutsideDrawList(list: FarDrawList): void {
    const active = new Set(list.notes.filter((note) => note.kind === "image").map((note) => note.id));
    for (const [id, entry] of imageLeases) {
      if (active.has(id) && board.notes[id]?.image && attachmentUrl(board.notes[id]!.image!.file) === entry.url) continue;
      entry.lease.release();
      imageLeases.delete(id);
    }
    for (const [id] of pendingImages) if (!active.has(id)) pendingImages.delete(id);
    for (const id of failedImages.keys()) if (!active.has(id)) failedImages.delete(id);
  }

  function imageBitmapsForFrame(list: FarDrawList, pixelRatio: number): Map<string, CanvasImageSource> {
    const result = new Map<string, CanvasImageSource>();
    const screen = viewportWorldRect(0);
    for (const item of list.notes) {
      if (item.kind !== "image") continue;
      const note = board.notes[item.id];
      const image = note?.image;
      if (!image) continue;
      const url = attachmentUrl(image.file);
      if (!url) continue;
      if (failedImages.get(item.id) && failedImages.get(item.id) !== url) failedImages.delete(item.id);
      const lease = imageLeases.get(item.id);
      if (lease?.url === url) {
        result.set(item.id, lease.lease.bitmap);
        continue;
      }
      const displayed = displayBitmapSize(
        image.naturalWidth,
        image.naturalHeight,
        item.width * camera.zoom * PX_PER_UNIT * pixelRatio,
        item.height * camera.zoom * PX_PER_UNIT * pixelRatio,
        1,
      );
      const cached = peekCachedDisplayBitmap(url, displayed.width, displayed.height);
      if (cached) {
        result.set(item.id, cached);
        continue;
      }
      if (imageLoadsInFlight >= 2 || pendingImages.has(item.id) || failedImages.get(item.id) === url ||
        !rectsIntersect(item, screen)) continue;
      imageLoadsInFlight += 1;
      const token = Symbol(item.id);
      pendingImages.set(item.id, { url, token });
      void acquireDisplayBitmap(url, displayed.width, displayed.height).then((decoded) => {
        imageLoadsInFlight = Math.max(0, imageLoadsInFlight - 1);
        const pending = pendingImages.get(item.id);
        const currentImage = board.notes[item.id]?.image;
        if (pending?.token !== token || pending.url !== url || !currentImage ||
          currentImage.file !== image.file || attachmentUrl(currentImage.file) !== url) {
          if (pending?.token === token) pendingImages.delete(item.id);
          decoded.release();
          scheduleFrame();
          return;
        }
        pendingImages.delete(item.id);
        failedImages.delete(item.id);
        imageLeases.get(item.id)?.lease.release();
        imageLeases.set(item.id, { url, lease: decoded });
        scheduleFrame();
      }).catch(() => {
        imageLoadsInFlight = Math.max(0, imageLoadsInFlight - 1);
        if (pendingImages.get(item.id)?.token === token) {
          pendingImages.delete(item.id);
          failedImages.set(item.id, url);
        }
        scheduleFrame();
      });
    }
    return result;
  }

  function rectsIntersect(first: Rect, second: Rect): boolean {
    return first.x <= second.x + second.width && second.x <= first.x + first.width &&
      first.y <= second.y + second.height && second.y <= first.y + first.height;
  }

  function rebuildNoteOrder(): void {
    noteOrder = new Map(board.order.map((id, index) => [id, index]));
  }

  onMount(() => {
    const stopBoard = onBoardMutation((ids) => {
      if (ids === null || ids.some((id) => !board.notes[id] || !noteOrder.has(id))) rebuildNoteOrder();
      drawListDirty = true;
      scheduleFrame();
    });
    const stopLinks = onLinksMutation(() => {
      drawListDirty = true;
      scheduleFrame();
    });
    const stopZones = onZonesMutation(() => {
      drawListDirty = true;
      scheduleFrame();
    });
    drawListDirty = true;
    scheduleFrame();
    return () => {
      disposed = true;
      stopBoard();
      stopLinks();
      stopZones();
      for (const { lease } of imageLeases.values()) lease.release();
      imageLeases.clear();
      pendingImages.clear();
      failedImages.clear();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  });

  $effect.root(() => {
    $effect(() => {
      const tier = lod.tier;
      const rect = { x: visible.rect.x, y: visible.rect.y, width: visible.rect.width, height: visible.rect.height };
      void camera.x;
      void camera.y;
      void camera.zoom;
      void viewport.width;
      void viewport.height;
      if (tier !== previousTier) {
        previousTier = tier;
        drawListDirty = true;
        if (tier !== "min") {
          for (const { lease } of imageLeases.values()) lease.release();
          imageLeases.clear();
          pendingImages.clear();
        }
      }
      if (!sameRect(previousRect, rect)) {
        previousRect = rect;
        drawListDirty = true;
      }
      scheduleFrame();
    });

    $effect(() => {
      const selected = new Set(selection.ids);
      if (editing.noteId) selected.add(editing.noteId);
      const focused = visibleInFocus();
      if (focused) for (const id of focused) selected.add(id);
      const selectedZones = new Set(selection.zoneIds);
      const selectedLinks = new Set(selectedLinkIds());
      const movingZoneId = zoneMovePreview.zoneId;
      if (!sameSet(previousSelected, selected) || !sameSet(previousSelectedZones, selectedZones) ||
        !sameSet(previousSelectedLinks, selectedLinks) || previousMoveZoneId !== movingZoneId) {
        previousSelected = selected;
        previousSelectedZones = selectedZones;
        previousSelectedLinks = selectedLinks;
        previousMoveZoneId = movingZoneId;
        drawListDirty = true;
        scheduleFrame();
      }
    });
  });

  function sameRect(first: Rect | null, second: Rect): boolean {
    return Boolean(first && first.x === second.x && first.y === second.y &&
      first.width === second.width && first.height === second.height);
  }

  function sameSet(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
    if (first.size !== second.size) return false;
    for (const value of first) if (!second.has(value)) return false;
    return true;
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
