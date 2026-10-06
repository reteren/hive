<script lang="ts">
  import { cachedClientRect } from "../board/boardRect";
  import { onMount } from "svelte";
  import { camera, setPointerScreen, viewport } from "../board/camera.svelte";
  import { screenToWorld } from "../board/cameraMath";
  import { board } from "../model/board.svelte";
  import { drawingTools } from "../drawing/tools.svelte";
  import { isErasablePhoto } from "../drawing/photoErase";
  import {
    beginImageEraseStroke,
    endImageEraseStroke,
    extendImageEraseStroke,
    finishImageErase,
    imageErase,
    redoImageEraseStroke,
    undoImageEraseStroke,
  } from "./imageErase.svelte";
  import { tool } from "../tools/tool.svelte";

  let boardElement: HTMLElement | null = null;
  let boardOrigin = $state({ x: 0, y: 0 });
  let activePointerId: number | null = null;
  let stroking = false;

  let activeNote = $derived(imageErase.noteId ? board.notes[imageErase.noteId] : null);
  $effect(() => {
    if (imageErase.noteId && tool.active !== "draw") {
      finishImageErase();
      return;
    }
    if (imageErase.noteId && (!activeNote || !isErasablePhoto(activeNote))) finishImageErase();
    if (imageErase.noteId) {
      const expected = imageErase.mode === "blur" ? "effect" : "eraser";
      if (drawingTools.active !== expected) drawingTools.active = expected;
    }
  });

  onMount(() => {
    boardElement = document.querySelector<HTMLElement>(".board");
    if (!boardElement) return;

    const updateBoardOrigin = () => {
      const rect = cachedClientRect(boardElement!);
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
      const rect = cachedClientRect(boardElement!);
      const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setPointerScreen(local);
      return screenToWorld(camera, viewport, local);
    }

    function updatePointer(event: PointerEvent): void {
      const rect = cachedClientRect(boardElement!);
      const inside = event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (inside) setPointerScreen({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      else setPointerScreen(null);
    }

    function cancelStroke(): void {
      if (stroking) endImageEraseStroke();
      stroking = false;
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

      // Photo edits show on the working copy right away; the file is written once when the mode ends.
      stroking = beginImageEraseStroke(imageErase.noteId, worldPoint(event), camera.zoom);
    }

    function onPointerMove(event: PointerEvent): void {
      if (insideBoard(event.target) || activePointerId === event.pointerId) updatePointer(event);
      else setPointerScreen(null);

      if (activePointerId !== event.pointerId) return;
      consume(event);
      if (!stroking) return;
      for (const sample of event.getCoalescedEvents?.() ?? [event]) extendImageEraseStroke(worldPoint(sample));
    }

    function onPointerUp(event: PointerEvent): void {
      if (activePointerId !== event.pointerId) return;
      consume(event);
      if (stroking) extendImageEraseStroke(worldPoint(event));
      activePointerId = null;
      cancelStroke();
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
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === "KeyZ" || event.code === "KeyY")) {
        // Inside the mode Undo/Redo step through strokes on the picture.
        consume(event);
        if (event.code === "KeyY" || event.shiftKey) redoImageEraseStroke();
        else undoImageEraseStroke();
        return;
      }
      if (["KeyB", "KeyE", "KeyF", "KeyJ", "KeyL", "KeyM", "KeyP", "KeyT", "KeyU", "KeyY"].includes(event.code) &&
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

</script>
