<!-- Screen-space selection outlines and pointer gestures for board notes (R1.4). -->
<script lang="ts">
  import { onMount } from "svelte";
  import { board as boardState, updateNote } from "../model/board.svelte";
  import { camera, pointer, viewport } from "../board/camera.svelte";
  import { pixelsPerUnit, screenToWorld, worldToScreen, type Point } from "../board/cameraMath";
  import { grid } from "../board/grid.svelte";
  import { execute, record, type HistoryCommand } from "../history/history.svelte";
  import { noteBounds, type Bounds } from "../notes/layout.svelte";
  import { isTextEditingTarget } from "../commands/focus";
  import {
    boundsAsFrame,
    cancelMoveGesture,
    cancelResizeGesture,
    createMoveGesture,
    createResizeGesture,
    crossedGestureThreshold,
    moveGestureChange,
    resizeGestureChange,
    updateMoveGesture,
    updateResizeGesture,
    type GeometryChange,
    type MoveGesture,
    type NoteFrame,
    type ResizeGesture,
  } from "./gestures";
  import { hitTestNotes, notesTouchingMarquee, rectFromPoints } from "./hitTesting";
  import {
    attachSelectionController,
    clearSelection,
    closeContextPick,
    selectMarquee,
    selectOnly,
    selection,
    setContextPick,
    setMarquee,
    setPrimary,
    toggleSelected,
  } from "./selection.svelte";
  import type { ResizeEdge } from "./resize";

  interface Outline {
    id: string;
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
    primary: boolean;
  }

  type ActivePointerGesture =
    | {
        kind: "move";
        pointerId: number;
        startScreen: Point;
        started: boolean;
        captured: boolean;
        gesture: MoveGesture;
      }
    | {
        kind: "resize";
        pointerId: number;
        startScreen: Point;
        started: boolean;
        captured: boolean;
        gesture: ResizeGesture;
      }
    | {
        kind: "marquee";
        pointerId: number;
        startScreen: Point;
        startWorld: Point;
        started: boolean;
        captured: boolean;
        additive: boolean;
      };

  let layer: HTMLDivElement;
  let boardElement: HTMLElement | null = null;
  let activeGesture: ActivePointerGesture | null = null;
  let grabGesture: MoveGesture | null = null;
  let grabStartWorld: Point | null = null;
  let suppressContextMenuUntil = 0;

  let outlines = $derived.by((): Outline[] => {
    const ppu = pixelsPerUnit(camera);
    return selection.ids.flatMap((id) => {
      const note = boardState.notes[id];
      if (!note) return [];

      const bounds = noteBounds(note);
      const screen = worldToScreen(camera, viewport, { x: bounds.x, y: bounds.y });
      return [
        {
          id,
          name: note.name,
          left: screen.x,
          top: screen.y,
          width: bounds.width * ppu,
          height: bounds.height * ppu,
          primary: selection.primaryId === id,
        },
      ];
    });
  });

  let marqueeScreen = $derived.by((): Bounds | null => {
    const bounds = selection.marquee;
    if (!bounds) return null;
    const topLeft = worldToScreen(camera, viewport, { x: bounds.x, y: bounds.y });
    const ppu = pixelsPerUnit(camera);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bounds.width * ppu,
      height: bounds.height * ppu,
    };
  });

  let contextNotes = $derived(
    selection.contextPick?.noteIds.flatMap((id) => {
      const note = boardState.notes[id];
      return note ? [{ id, name: note.name }] : [];
    }) ?? [],
  );

  onMount(() => {
    boardElement = layer.parentElement;
    if (!boardElement) return;

    const boardEl = boardElement;

    function onPointerDown(event: PointerEvent): void {
      if (event.button === 2 && grabGesture) {
        suppressContextMenuUntil = performance.now() + 750;
        event.preventDefault();
        event.stopPropagation();
        cancelGrab();
        return;
      }

      if (event.button !== 0 || event.isPrimary === false) return;

      const local = localPoint(event);
      if (!local) return;

      if (grabGesture) {
        event.preventDefault();
        event.stopPropagation();
        updateGrabAt(screenToWorld(camera, viewport, local), event.ctrlKey);
        commitGrab();
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(".selection-context-pick")) return;

      const world = screenToWorld(camera, viewport, local);
      if (event.altKey) {
        const hits = hitTestNotes(world, boardState.notes, boardState.order);
        if (hits.length > 1) {
          event.preventDefault();
          event.stopPropagation();
          setContextPick(hits, local, viewport);
          return;
        }
        if (hits.length === 1) {
          closeContextPick();
          selectOnly(hits[0]);
          return;
        }
      }

      closeContextPick();

      const resizeHandle = target.closest<HTMLElement>("[data-resize-handle]");
      if (resizeHandle) {
        const id = resizeHandle.dataset.noteId;
        const edge = resizeHandle.dataset.resizeHandle as ResizeEdge | undefined;
        if (id && edge && id === selection.primaryId) startResize(event, id, edge, local, world);
        return;
      }

      const header = target.closest("[data-note-header]");
      if (header && !isTextEditingTarget(event.target)) {
        const noteRoot = header.closest<HTMLElement>("[data-note-id]");
        const id = noteRoot?.dataset.noteId;
        if (!id || !boardState.notes[id]) return;

        if (event.ctrlKey) {
          if (!toggleSelected(id)) return;
        } else if (selection.ids.includes(id)) {
          setPrimary(id);
        } else {
          selectOnly(id);
        }

        if (!selection.ids.includes(id)) return;
        const frames = framesForSelection();
        if (frames.length === 0) return;
        startMove(event, local, world, frames, id);
        return;
      }

      if (target.closest("[data-note-id]") || target.closest("[data-selection-ignore]")) return;

      activeGesture = {
        kind: "marquee",
        pointerId: event.pointerId,
        startScreen: local,
        startWorld: world,
        started: false,
        captured: false,
        additive: event.ctrlKey,
      };
    }

    function onPointerMove(event: PointerEvent): void {
      const local = localPoint(event);
      if (!local) return;

      if (activeGesture && activeGesture.pointerId === event.pointerId) {
        updatePointerGesture(event, local);
        return;
      }

      // A middle-button pan remains owned by the camera while G move mode is active.
      if (grabGesture && event.buttons === 0 && isPointInsideBoard(local)) {
        updateGrabAt(screenToWorld(camera, viewport, local), event.ctrlKey);
      }
    }

    function onPointerUp(event: PointerEvent): void {
      if (activeGesture?.pointerId !== event.pointerId) return;
      const local = localPoint(event);
      if (local) updatePointerGesture(event, local, false);
      finishPointerGesture(event.pointerId, false);
    }

    function onPointerCancel(event: PointerEvent): void {
      if (activeGesture?.pointerId === event.pointerId) finishPointerGesture(event.pointerId, true);
    }

    function onLostPointerCapture(event: PointerEvent): void {
      if (activeGesture?.pointerId === event.pointerId) finishPointerGesture(event.pointerId, true, false);
    }

    function onClick(event: MouseEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || event.altKey || target.closest(".selection-context-pick")) return;

      const body = target.closest("[data-note-body]");
      const noteRoot = body?.closest<HTMLElement>("[data-note-id]");
      const id = noteRoot?.dataset.noteId;
      if (!id || !boardState.notes[id]) return;

      if (event.ctrlKey) toggleSelected(id);
      else selectOnly(id);
    }

    function onDoubleClick(event: MouseEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      const handle = target?.closest<HTMLElement>('[data-resize-handle="bottom"]');
      const id = handle?.dataset.noteId;
      const note = id ? boardState.notes[id] : undefined;
      if (!id || !note || note.height === null) return;

      event.preventDefault();
      event.stopPropagation();
      const before = frameForNote(id);
      const after = { ...before, height: null };
      execute(geometryCommand("Resize", note.name, [before], [after]));
    }

    function onContextMenu(event: MouseEvent): void {
      if (!grabGesture && performance.now() > suppressContextMenuUntil) return;
      suppressContextMenuUntil = 0;
      event.preventDefault();
      event.stopPropagation();
      if (grabGesture) cancelGrab();
    }

    boardEl.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    boardEl.addEventListener("lostpointercapture", onLostPointerCapture, true);
    boardEl.addEventListener("click", onClick, true);
    boardEl.addEventListener("dblclick", onDoubleClick, true);
    boardEl.addEventListener("contextmenu", onContextMenu, true);

    const detachController = attachSelectionController({ escape, startGrab });

    function onWindowBlur(): void {
      if (activeGesture) finishPointerGesture(activeGesture.pointerId, true);
      if (grabGesture) cancelGrab();
    }

    window.addEventListener("blur", onWindowBlur);

    return () => {
      if (activeGesture) finishPointerGesture(activeGesture.pointerId, true);
      if (grabGesture) cancelGrab();
      detachController();
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      boardEl.removeEventListener("pointerdown", onPointerDown, true);
      boardEl.removeEventListener("lostpointercapture", onLostPointerCapture, true);
      boardEl.removeEventListener("click", onClick, true);
      boardEl.removeEventListener("dblclick", onDoubleClick, true);
      boardEl.removeEventListener("contextmenu", onContextMenu, true);
      boardElement = null;
    };
  });

  function localPoint(event: Pick<PointerEvent, "clientX" | "clientY">): Point | null {
    if (!boardElement) return null;
    const rect = boardElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function capturePointer(pointerId: number): void {
    boardElement?.setPointerCapture(pointerId);
  }

  function isPointInsideBoard(point: Point): boolean {
    if (!boardElement) return false;
    const rect = boardElement.getBoundingClientRect();
    return point.x >= 0 && point.y >= 0 && point.x <= rect.width && point.y <= rect.height;
  }

  function releasePointer(pointerId: number): void {
    if (boardElement?.hasPointerCapture(pointerId)) boardElement.releasePointerCapture(pointerId);
  }

  function framesForSelection(): NoteFrame[] {
    return selection.ids.flatMap((id) => (boardState.notes[id] ? [frameForNote(id)] : []));
  }

  function frameForNote(id: string): NoteFrame {
    const note = boardState.notes[id];
    const bounds = noteBounds(note);
    return boundsAsFrame(id, bounds, note.height);
  }

  function startMove(event: PointerEvent, screen: Point, world: Point, frames: NoteFrame[], anchorId: string): void {
    activeGesture = {
      kind: "move",
      pointerId: event.pointerId,
      startScreen: screen,
      started: false,
      captured: false,
      gesture: createMoveGesture(frames, anchorId, world),
    };
  }

  function startResize(
    event: PointerEvent,
    id: string,
    edge: ResizeEdge,
    screen: Point,
    world: Point,
  ): void {
    const note = boardState.notes[id];
    if (!note) return;
    closeContextPick();
    activeGesture = {
      kind: "resize",
      pointerId: event.pointerId,
      startScreen: screen,
      started: false,
      captured: false,
      gesture: createResizeGesture(frameForNote(id), noteBounds(note).height, edge, world),
    };
  }

  function updatePointerGesture(event: PointerEvent, screen: Point, captureForFollowup = true): void {
    const gesture = activeGesture;
    if (!gesture) return;

    if (!gesture.started && !crossedGestureThreshold(gesture.startScreen, screen)) return;
    if (!gesture.captured && captureForFollowup) {
      capturePointer(event.pointerId);
      gesture.captured = true;
    }
    gesture.started = true;
    const world = screenToWorld(camera, viewport, screen);

    if (gesture.kind === "marquee") {
      setMarquee(rectFromPoints(gesture.startWorld, world));
      return;
    }

    if (gesture.kind === "move") {
      gesture.gesture = updateMoveGesture(gesture.gesture, world, grid.snap || event.ctrlKey, grid.step);
      applyFrames(gesture.gesture.after);
      return;
    }

    gesture.gesture = updateResizeGesture(gesture.gesture, world, grid.snap || event.ctrlKey, grid.step);
    applyFrames([gesture.gesture.after]);
  }

  function finishPointerGesture(pointerId: number, cancelled: boolean, release = true): void {
    const gesture = activeGesture;
    if (!gesture || gesture.pointerId !== pointerId) return;
    activeGesture = null;

    if (gesture.kind === "marquee") {
      const marquee = selection.marquee;
      if (cancelled) {
        setMarquee(null);
      } else if (gesture.started && marquee) {
        const ids = notesTouchingMarquee(marquee, boardState.notes, boardState.order);
        selectMarquee(ids, gesture.additive);
        setMarquee(null);
      } else {
        setMarquee(null);
        if (!gesture.additive) clearSelection();
      }
    } else if (gesture.kind === "move") {
      if (cancelled) {
        applyFrames(cancelMoveGesture(gesture.gesture));
      } else if (gesture.started) {
        const change = moveGestureChange(gesture.gesture);
        if (change) recordGeometryChange("Move", targetForMove(change.before, gesture.gesture.anchorId), change);
      }
    } else if (cancelled) {
      applyFrames([cancelResizeGesture(gesture.gesture)]);
    } else if (gesture.started) {
      const change = resizeGestureChange(gesture.gesture);
      if (change) {
        const note = boardState.notes[change.before[0].id];
        recordGeometryChange("Resize", note?.name ?? "", change);
      }
    }

    if (release) releasePointer(pointerId);
  }

  function updateGrabAt(world: Point, ctrlHeld: boolean): void {
    if (!grabGesture) return;
    if (!grabStartWorld) {
      grabStartWorld = { ...world };
      grabGesture = createMoveGesture(grabGesture.before, grabGesture.anchorId, world);
      return;
    }

    grabGesture = updateMoveGesture(grabGesture, world, grid.snap || ctrlHeld, grid.step);
    applyFrames(grabGesture.after);
  }

  function startGrab(): void {
    if (grabGesture || selection.ids.length === 0) return;
    const frames = framesForSelection();
    if (frames.length === 0) return;
    const anchorId = selection.primaryId && boardState.notes[selection.primaryId]
      ? selection.primaryId
      : frames[0].id;
    grabGesture = createMoveGesture(frames, anchorId, pointer.world ?? { x: frames[0].x, y: frames[0].y });
    grabStartWorld = pointer.world ? { ...pointer.world } : null;
    selection.grabActive = true;
  }

  function commitGrab(): void {
    if (!grabGesture) return;
    const change = moveGestureChange(grabGesture);
    if (change) recordGeometryChange("Move", targetForMove(change.before, grabGesture.anchorId), change);
    grabGesture = null;
    grabStartWorld = null;
    selection.grabActive = false;
  }

  function cancelGrab(): void {
    if (!grabGesture) return;
    applyFrames(cancelMoveGesture(grabGesture));
    grabGesture = null;
    grabStartWorld = null;
    selection.grabActive = false;
  }

  function escape(): void {
    if (activeGesture) {
      finishPointerGesture(activeGesture.pointerId, true);
      return;
    }
    if (grabGesture) {
      cancelGrab();
      return;
    }
    if (selection.contextPick) {
      closeContextPick();
      return;
    }
    clearSelection();
  }

  function applyFrames(frames: readonly NoteFrame[]): void {
    for (const frame of frames) {
      updateNote(frame.id, { x: frame.x, y: frame.y, width: frame.width, height: frame.height });
    }
  }

  function targetForMove(frames: readonly NoteFrame[], anchorId: string): string {
    if (frames.length !== 1) return `${frames.length} notes`;
    return boardState.notes[anchorId]?.name ?? boardState.notes[frames[0]?.id ?? ""]?.name ?? "";
  }

  function recordGeometryChange(label: "Move" | "Resize", target: string, change: GeometryChange): void {
    record(geometryCommand(label, target, change.before, change.after));
  }

  function geometryCommand(
    label: "Move" | "Resize",
    target: string,
    before: readonly NoteFrame[],
    after: readonly NoteFrame[],
  ): HistoryCommand {
    return {
      label,
      target,
      do: () => applyFrames(after),
      undo: () => applyFrames(before),
    };
  }

  function chooseContextNote(id: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (boardState.notes[id]) selectOnly(id);
    closeContextPick();
  }
</script>

<div class="selection-layer" bind:this={layer} aria-hidden="false">
  {#each outlines as outline (outline.id)}
    <div
      class="selection-outline"
      role="group"
      data-selected="true"
      data-primary={outline.primary ? "true" : undefined}
      data-note-id={outline.id}
      style:left="{outline.left}px"
      style:top="{outline.top}px"
      style:width="{outline.width}px"
      style:height="{outline.height}px"
      aria-label="Selected {outline.name}"
    >
      {#if outline.primary}
        <button
          class="resize-handle resize-right"
          type="button"
          data-resize-handle="right"
          data-note-id={outline.id}
          aria-label="Resize {outline.name} width"
          title="Resize width"
        ></button>
        <button
          class="resize-handle resize-bottom"
          type="button"
          data-resize-handle="bottom"
          data-note-id={outline.id}
          aria-label="Resize {outline.name} height"
          title="Resize height; double-click for auto height"
        ></button>
        <button
          class="resize-handle resize-corner"
          type="button"
          data-resize-handle="corner"
          data-note-id={outline.id}
          aria-label="Resize {outline.name} width and height"
          title="Resize width and height"
        ></button>
      {/if}
    </div>
  {/each}

  {#if marqueeScreen}
    <div
      class="marquee"
      style:left="{marqueeScreen.x}px"
      style:top="{marqueeScreen.y}px"
      style:width="{marqueeScreen.width}px"
      style:height="{marqueeScreen.height}px"
      aria-hidden="true"
    ></div>
  {/if}

  {#if selection.grabActive}
    <div class="grab-hint" role="status">Move selection · click to place · Esc or right-click to cancel</div>
  {/if}

  {#if selection.contextPick}
    <div
      class="selection-context-pick"
      role="listbox"
      aria-label="Choose overlapping note"
      style:left="{selection.contextPick.x}px"
      style:top="{selection.contextPick.y}px"
    >
      {#each contextNotes as note (note.id)}
        <button
          type="button"
          role="option"
          aria-selected="false"
          data-context-note-id={note.id}
          onclick={(event) => chooseContextNote(note.id, event)}
        >
          {note.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .selection-layer {
    position: absolute;
    inset: 0;
    z-index: 5;
    overflow: hidden;
    pointer-events: none;
  }

  .selection-outline {
    position: absolute;
    border: 1px solid var(--accent);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }

  .selection-outline[data-primary="true"] {
    border-width: 1.5px;
  }

  .resize-handle {
    position: absolute;
    z-index: 1;
    display: block;
    padding: 0;
    border: 1px solid #191919;
    border-radius: 3px;
    background: var(--accent);
    pointer-events: auto;
    touch-action: none;
  }

  .resize-handle:hover {
    background: #ffd260;
  }

  .resize-right {
    top: 50%;
    right: -5px;
    width: 9px;
    height: 24px;
    transform: translateY(-50%);
    cursor: ew-resize;
  }

  .resize-bottom {
    bottom: -5px;
    left: 50%;
    width: 24px;
    height: 9px;
    transform: translateX(-50%);
    cursor: ns-resize;
  }

  .resize-corner {
    right: -5px;
    bottom: -5px;
    width: 11px;
    height: 11px;
    cursor: nwse-resize;
  }

  .marquee {
    position: absolute;
    border: 1px solid rgba(232, 176, 48, 0.95);
    background: rgba(232, 176, 48, 0.12);
  }

  .grab-hint {
    position: absolute;
    top: 10px;
    left: 50%;
    padding: 5px 8px;
    transform: translateX(-50%);
    border: 1px solid #594518;
    border-radius: 3px;
    background: rgba(35, 35, 35, 0.96);
    color: var(--text);
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }

  .selection-context-pick {
    position: absolute;
    z-index: 2;
    display: flex;
    min-width: 120px;
    max-width: 184px;
    max-height: 240px;
    flex-direction: column;
    overflow: auto;
    padding: 4px;
    border: 1px solid #4a4a4a;
    border-radius: 4px;
    background: var(--bg-panel-raised);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
    pointer-events: auto;
  }

  .selection-context-pick button {
    overflow: hidden;
    padding: 5px 7px;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--text);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .selection-context-pick button:hover,
  .selection-context-pick button:focus-visible {
    background: var(--bg-active);
  }
</style>
