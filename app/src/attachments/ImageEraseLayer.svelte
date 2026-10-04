<script lang="ts">
  import { onMount } from "svelte";
  import { camera, setPointerScreen, viewport } from "../board/camera.svelte";
  import { screenToWorld, worldToScreen } from "../board/cameraMath";
  import { board } from "../model/board.svelte";
  import { createStroke, type DrawStroke } from "../drawing/brush";
  import { drawingTools } from "../drawing/tools.svelte";
  import { levelPxPerUnit, type BrushSettings } from "../drawing/types";
  import { isErasablePhoto, photoEraseGeometry, worldPointToPhotoPixel } from "../drawing/photoErase";
  import { reportImportError } from "./service";
  import { imageErase, finishImageErase, eraseImageStroke } from "./imageErase.svelte";
  import { tool } from "../tools/tool.svelte";

  let boardElement: HTMLElement | null = null;
  let boardOrigin = $state({ x: 0, y: 0 });
  let stroke: DrawStroke | null = null;
  let strokeSettings: BrushSettings | null = null;
  let strokeNoteId: string | null = null;
  let activePointerId: number | null = null;
  let commitQueue = Promise.resolve();

  let activeNote = $derived(imageErase.noteId ? board.notes[imageErase.noteId] : null);
  let geometry = $derived(activeNote ? photoEraseGeometry(activeNote) : null);
  let hintPosition = $derived.by(() => {
    if (!geometry || typeof window === "undefined") return null;
    const point = worldToScreen(camera, viewport, { x: geometry.x, y: geometry.y });
    return {
      x: Math.max(8, Math.min(window.innerWidth - 186, boardOrigin.x + point.x)),
      y: Math.max(8, boardOrigin.y + point.y - 30),
    };
  });

  $effect(() => {
    if (imageErase.noteId && tool.active !== "draw") {
      finishImageErase();
      return;
    }
    if (imageErase.noteId && (!activeNote || !isErasablePhoto(activeNote))) finishImageErase();
    if (imageErase.noteId && drawingTools.active !== "eraser") drawingTools.active = "eraser";
  });

  onMount(() => {
    boardElement = document.querySelector<HTMLElement>(".board");
    if (!boardElement) return;

    const updateBoardOrigin = () => {
      const rect = boardElement!.getBoundingClientRect();
      boardOrigin = { x: rect.left, y: rect.top };
    };
    updateBoardOrigin();
    const observer = new ResizeObserver(updateBoardOrigin);
    observer.observe(boardElement);
    window.addEventListener("resize", updateBoardOrigin);
    window.addEventListener("scroll", updateBoardOrigin, true);

    function insideBoard(target: EventTarget | null): boolean {
      return target instanceof Node && boardElement!.contains(target);
    }

    function consume(event: Event): void {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function worldPoint(event: PointerEvent): { x: number; y: number } {
      const rect = boardElement!.getBoundingClientRect();
      const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setPointerScreen(local);
      return screenToWorld(camera, viewport, local);
    }

    function updatePointer(event: PointerEvent): void {
      const rect = boardElement!.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (inside) setPointerScreen({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      else setPointerScreen(null);
    }

    function cancelStroke(): void {
      stroke?.dispose();
      stroke = null;
      strokeSettings = null;
      strokeNoteId = null;
    }

    function onPointerDown(event: PointerEvent): void {
      if (imageErase.noteId === null || !insideBoard(event.target)) return;
      updatePointer(event);
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("[data-draw-overlay-control]")) return;

      consume(event);
      if (activePointerId !== null) return;
      activePointerId = event.pointerId;
      if (event.target instanceof Element && event.target.closest("[data-selection-ignore]")) return;

      const noteId = imageErase.noteId;
      const note = board.notes[noteId];
      const targetGeometry = note ? photoEraseGeometry(note) : null;
      const point = worldPoint(event);
      if (!targetGeometry || !worldPointToPhotoPixel(point, targetGeometry)) return;

      strokeSettings = { ...drawingTools.brush };
      strokeNoteId = noteId;
      stroke = createStroke({ ...strokeSettings, color: "#ffffff" }, camera.zoom);
      stroke.add(point, pointerPressure(event));
    }

    function onPointerMove(event: PointerEvent): void {
      if (insideBoard(event.target) || activePointerId === event.pointerId) updatePointer(event);
      else setPointerScreen(null);

      if (activePointerId !== event.pointerId) return;
      consume(event);
      if (!stroke) return;
      stroke.add(worldPoint(event), pointerPressure(event));
    }

    function onPointerUp(event: PointerEvent): void {
      if (activePointerId !== event.pointerId) return;
      consume(event);
      const current = stroke;
      const settings = strokeSettings;
      const noteId = strokeNoteId;
      const point = worldPoint(event);
      current?.add(point, pointerPressure(event));
      const finished = current?.finish();
      activePointerId = null;
      stroke = null;
      strokeSettings = null;
      strokeNoteId = null;

      if (!current || !settings || !noteId || !finished) {
        current?.dispose();
        return;
      }

      // Read the GPU stroke back now: the stroke's textures are released right after.
      const mask = finished.toCanvas();
      const operation = commitQueue.then(() => eraseImageStroke(
        noteId,
        mask,
        finished.rasterX,
        finished.rasterY,
        1,
        levelPxPerUnit(finished.level),
      ));
      commitQueue = operation.then(() => undefined, () => undefined);
      void operation.catch((error: unknown) => {
        reportImportError(error instanceof Error ? error.message : String(error));
      }).finally(() => {
        mask.width = 0;
        mask.height = 0;
      });
      current.dispose();
    }

    function onPointerCancel(event: PointerEvent): void {
      if (activePointerId !== event.pointerId) return;
      consume(event);
      activePointerId = null;
      cancelStroke();
    }

    function onPointerOut(event: PointerEvent): void {
      if (!insideBoard(event.target)) return;
      const next = event.relatedTarget;
      if (next instanceof Node && boardElement!.contains(next)) return;
      if (activePointerId !== event.pointerId) setPointerScreen(null);
    }

    function onContextMenu(event: MouseEvent): void {
      if (imageErase.noteId !== null && insideBoard(event.target)) consume(event);
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (imageErase.noteId === null || event.defaultPrevented) return;
      if (event.code === "Escape" && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        consume(event);
        cancelStroke();
        // Keep consuming this pointer's eventual up event after Esc cancels a held stroke.
        finishImageErase();
        return;
      }
      if (["KeyB", "KeyF", "KeyM", "KeyL", "KeyP"].includes(event.code) &&
        !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) consume(event);
    }

    function onWindowBlur(): void {
      activePointerId = null;
      cancelStroke();
      setPointerScreen(null);
    }

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("pointerout", onPointerOut, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBoardOrigin);
      window.removeEventListener("scroll", updateBoardOrigin, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("pointerout", onPointerOut, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onWindowBlur);
      cancelStroke();
    };
  });

  function pointerPressure(event: PointerEvent): number {
    return event.pointerType !== "pen" || !Number.isFinite(event.pressure) || event.pressure <= 0
      ? 0.5
      : Math.min(1, Math.max(0, event.pressure));
  }
</script>

{#if imageErase.noteId && hintPosition}
  <div class="image-erase-hint" style={`left:${hintPosition.x}px;top:${hintPosition.y}px`} data-image-erase-hint>
    Erasing image · Esc to finish
  </div>
{/if}

<style>
  .image-erase-hint {
    position: fixed;
    z-index: 10002;
    padding: 5px 8px;
    border: 1px solid rgb(255 190 78 / 52%);
    border-radius: 5px;
    background: rgb(27 25 21 / 94%);
    box-shadow: 0 3px 12px rgb(0 0 0 / 38%);
    color: #ffe0a1;
    font: 11px/1.2 system-ui, sans-serif;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
