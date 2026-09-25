<!-- Screen-space selection outlines and pointer gestures for board notes (R1.4). -->
<script lang="ts">
  import { onMount } from "svelte";
  import { board as boardState, updateNote } from "../model/board.svelte";
  import { camera, pointer, viewport } from "../board/camera.svelte";
  import { pixelsPerUnit, screenToWorld, worldToScreen, type Point } from "../board/cameraMath";
  import { grid } from "../board/grid.svelte";
  import { execute, record, type HistoryCommand } from "../history/history.svelte";
  import { editing } from "../notes/editing.svelte";
  import type { NoteKind } from "../model/note";
  import { maximumResizableHeight, maximumResizableHeightForNote, noteBounds, renderedNoteMetrics, type Bounds } from "../notes/layout.svelte";
  import { zoneBounds, type Zone } from "../model/zone";
  import { zones, updateZone } from "../model/zones.svelte";
  import { zoneMembers } from "../zones/membership.svelte";
  import { isDimmed } from "../beacons/focus.svelte";
  import {
    createZoneMoveGesture,
    createZoneResizeGesture,
    isRectZone,
    updateZoneMoveGesture,
    updateZoneResizeGesture,
    zoneGestureChanged,
    type MemberPosition,
    type ZoneMoveGesture,
    type ZoneResizeGesture,
  } from "../zones/zoneGestures";
  import { isTextEditingTarget } from "../commands/focus";
  import {
    clearModuleDropPreview,
    tryInsertModuleOnDrop,
    updateModuleDropPreview,
  } from "../modules/moduleDrop.svelte";
  import {
    boundsAsFrame,
    cancelMoveGesture,
    cancelResizeGesture,
    createMoveGesture,
    createResizeGesture,
    crossedGestureThreshold,
    moveGestureChange,
    resizeGestureChange,
    shouldCancelForLineTool,
    updateMoveGesture,
    updateResizeGesture,
    type GeometryChange,
    type MoveGesture,
    type NoteFrame,
    type ResizeGesture,
  } from "./gestures";
  import { hitTestNotes, hitTestZones, noteSelectionCornerRadius, notesTouchingMarquee, rectFromPoints, zonesTouchingMarquee } from "./hitTesting";
  import {
    cancelGroupScaleGesture,
    createGroupScaleGesture,
    groupScaleGestureChange,
    unionBounds,
    updateGroupScaleGesture,
    type GroupScaleGesture,
  } from "./groupScale";
  import {
    attachSelectionController,
    changeSelectionUndoable,
    clearSelectionUndoable,
    closeContextPick,
    selection,
    setContextPick,
    setMarquee,
  } from "./selection.svelte";
  import { selectionForEditing } from "./editingSelection";
  import {
    noteMoveStarts,
    notePressIntent,
    shouldToggleSelectedHeaderAfterGesture,
  } from "./noteMoveIntent";
  import { hasResizeHandle, isStandaloneModuleKind, maximumWidthForKind, RESIZE_EDGES, resizeEdgeAxes, type ResizeEdge } from "./resize";
  import { resizeDoubleClickAction } from "./resizeDoubleClick";
  import { startNoteEditing } from "../editor/editorSession";
  import { isLineTool, tool } from "../tools/tool.svelte";
  import {
    createPrecisionDeltaTracker,
    setPrecisionAlt,
    updatePrecisionDelta,
    type PrecisionDeltaTracker,
  } from "./precision";
  import { resolveModuleDropDecision } from "./moduleDropDecision";

  interface Outline {
    id: string;
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
    primary: boolean;
    kind: NoteKind;
    widthLocked: boolean;
  }

  interface ZoneOutline {
    id: string;
    name: string;
    color: string;
    left: number;
    top: number;
    width: number;
    height: number;
    primary: boolean;
    resizable: boolean;
  }

  type ActivePointerGesture =
    | {
        kind: "move";
        pointerId: number;
        startScreen: Point;
        precision: PrecisionDeltaTracker;
        started: boolean;
        captured: boolean;
        gesture: MoveGesture;
        toggleOnClickId: string | null;
      }
    | {
        kind: "body-move";
        pointerId: number;
        startScreen: Point;
        startWorld: Point;
        precision: PrecisionDeltaTracker;
        noteId: string;
        noteElement: HTMLElement;
        previousUserSelect: string;
        started: boolean;
        captured: boolean;
        gesture: MoveGesture | null;
      }
    | {
        kind: "resize";
        pointerId: number;
        startScreen: Point;
        precision: PrecisionDeltaTracker;
        started: boolean;
        captured: boolean;
        gesture: ResizeGesture;
      }
    | {
        kind: "group-scale";
        pointerId: number;
        startScreen: Point;
        precision: PrecisionDeltaTracker;
        started: boolean;
        captured: boolean;
        gesture: GroupScaleGesture;
      }
    | {
        kind: "zone-move";
        pointerId: number;
        startScreen: Point;
        precision: PrecisionDeltaTracker;
        started: boolean;
        captured: boolean;
        gesture: ZoneMoveGesture;
      }
    | {
        kind: "zone-resize";
        pointerId: number;
        startScreen: Point;
        precision: PrecisionDeltaTracker;
        started: boolean;
        captured: boolean;
        gesture: ZoneResizeGesture;
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

  interface PendingAltContextPick {
    pointerId: number;
    startScreen: Point;
    noteIds: string[];
    point: Point;
    selectedIds: string[];
    primaryId: string | null;
  }

  let layer: HTMLDivElement;
  let boardElement: HTMLElement | null = null;
  let activeGesture: ActivePointerGesture | null = null;
  let grabGesture: MoveGesture | null = null;
  let grabStartWorld: Point | null = null;
  let grabPrecision: PrecisionDeltaTracker | null = null;
  let pendingAltContextPick: PendingAltContextPick | null = null;
  let altHeld = false;
  let suppressContextMenuUntil = 0;
  let suppressBodyClickUntil = 0;
  let zoneCollisionHint = $state(false);
  let lineToolActive = $derived(isLineTool());
  let noteOutlineCornerRadius = $derived(`${noteSelectionCornerRadius(camera.zoom)}px`);

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
          kind: note.type,
          widthLocked: note.widthLocked ?? false,
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

  let zoneOutlines = $derived.by((): ZoneOutline[] => {
    const ppu = pixelsPerUnit(camera);
    return selection.zoneIds.flatMap((id) => {
      const zone = zones.byId[id];
      if (!zone) return [];
      const bounds = zoneBounds(zone);
      const screen = worldToScreen(camera, viewport, { x: bounds.x, y: bounds.y });
      return [{
        id, name: zone.name, color: zone.color,
        left: screen.x, top: screen.y,
        width: bounds.width * ppu, height: bounds.height * ppu,
        primary: selection.zoneIds.at(-1) === id,
        resizable: isRectZone(zone),
      }];
    });
  });

  let groupBounds = $derived.by(() => {
    if (selection.ids.length < 2 || selection.zoneIds.length > 0) return null;
    const bounds = selection.ids.flatMap((id) => {
      const note = boardState.notes[id];
      return note ? [noteBounds(note)] : [];
    });
    return unionBounds(bounds);
  });

  let groupOutline = $derived.by(() => {
    if (!groupBounds) return null;
    const screen = worldToScreen(camera, viewport, { x: groupBounds.x, y: groupBounds.y });
    const ppu = pixelsPerUnit(camera);
    return {
      left: screen.x,
      top: screen.y,
      width: groupBounds.width * ppu,
      height: groupBounds.height * ppu,
    };
  });

  let contextNotes = $derived(
    selection.contextPick?.noteIds.flatMap((id) => {
      const note = boardState.notes[id];
      return note ? [{ id, name: note.name }] : [];
    }) ?? [],
  );

  $effect(() => {
    const editingId = editing.noteId;
    if (editingId && boardState.notes[editingId]) ensureEditingSelection(editingId);
  });

  $effect(() => {
    if (!lineToolActive) return;
    const gesture = activeGesture;
    if (gesture && shouldCancelForLineTool(gesture.kind, lineToolActive)) {
      finishPointerGesture(gesture.pointerId, true);
    }
  });

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
      suppressBodyClickUntil = 0;

      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(".selection-context-pick, [data-create-menu], [data-selection-ignore]")) return;

      const local = localPoint(event);
      if (!local) return;

      if (grabGesture) {
        event.preventDefault();
        event.stopPropagation();
        const world = screenToWorld(camera, viewport, local);
        updateGrabAt(world, event.ctrlKey, event.altKey);
        commitGrab(world);
        return;
      }

      if (tool.active === "zone" || lineToolActive) return;

      const world = screenToWorld(camera, viewport, local);
      const groupHandle = target.closest<HTMLElement>("[data-group-scale-handle]");
      const resizeHandle = target.closest<HTMLElement>("[data-resize-handle]");
      const zoneResizeHandle = target.closest<HTMLElement>("[data-zone-resize-handle]");
      const header = target.closest("[data-note-header]");
      const noteRoot = target.closest<HTMLElement>("[data-note-id]");
      const noteId = noteRoot?.dataset.noteId ?? null;
      const noteBody = target.closest("[data-note-body]");
      const region = resizeHandle
        ? "resize-handle"
        : header
          ? "header"
          : noteBody
            ? "body"
            : noteRoot
              ? "frame"
              : "outside";
      const pressIntent = notePressIntent(region, noteId, editing.noteId);
      const canDragFromTarget = groupHandle !== null ||
        (pressIntent === "move-candidate" && !isTextEditingTarget(event.target));
      pendingAltContextPick = null;

      if (event.altKey) {
        const hits = hitTestNotes(world, boardState.notes, boardState.order, noteBounds, (id) => !isDimmed(id));
        if (hits.length > 1 && canDragFromTarget && !event.ctrlKey) {
          pendingAltContextPick = {
            pointerId: event.pointerId,
            startScreen: local,
            noteIds: hits,
            point: local,
            selectedIds: [...selection.ids],
            primaryId: selection.primaryId,
          };
        } else if (hits.length > 1) {
          event.preventDefault();
          event.stopPropagation();
          setContextPick(hits, local, viewport);
          return;
        } else if (hits.length === 1 && !canDragFromTarget) {
          closeContextPick();
          selectNoteUndoable(hits[0]);
          return;
        }
      }

      closeContextPick();

      if (zoneResizeHandle) {
        const id = zoneResizeHandle.dataset.zoneId;
        const edge = zoneResizeHandle.dataset.zoneResizeHandle as ResizeEdge | undefined;
        if (id && edge && id === selection.zoneIds.at(-1) && zones.byId[id]) {
          startZoneResize(event, id, edge, local, world);
        }
        return;
      }

      if (groupHandle && selection.ids.length > 1 && groupBounds) {
        const edge = groupHandle.dataset.groupScaleHandle as ResizeEdge | undefined;
        const frames = framesForSelection();
        if (edge && frames.length > 1) startGroupScale(event, edge, local, world, frames, groupBounds);
        return;
      }

      if (resizeHandle) {
        const id = resizeHandle.dataset.noteId;
        const edge = resizeHandle.dataset.resizeHandle as ResizeEdge | undefined;
        if (id && edge && id === selection.primaryId && hasResizeHandle(
          boardState.notes[id]?.type, edge, boardState.notes[id]?.widthLocked ?? false,
        )) {
          startResize(event, id, edge, local, world);
        }
        return;
      }

      if (header && !isTextEditingTarget(event.target) && !(noteId && isDimmed(noteId))) {
        const id = noteRoot?.dataset.noteId;
        if (!id || !boardState.notes[id] || isDimmed(id)) return;

        let toggleOnClickId: string | null = null;
        if (event.ctrlKey) {
          if (selection.ids.includes(id)) {
            toggleOnClickId = id;
          } else {
            toggleNoteUndoable(id);
          }
        } else if (selection.ids.includes(id)) {
          setPrimaryUndoable(id);
        } else {
          selectNoteUndoable(id);
        }

        if (!selection.ids.includes(id)) return;
        const frames = framesForSelection();
        if (frames.length === 0) return;
        startMove(event, local, world, frames, id, toggleOnClickId);
        return;
      }

      if (noteRoot && !(noteId && isDimmed(noteId))) {
        if (isTextEditingTarget(event.target)) return;
        const intent = notePressIntent(noteBody ? "body" : "frame", noteId, editing.noteId);
        if (intent === "move-candidate" && noteId && boardState.notes[noteId]) {
          startBodyMove(event, local, world, noteId, noteRoot);
        }
        return;
      }

      // Zones remain selectable during beacon focus; they are never dimmed objects.
      if (tool.active === "select" && !target.closest("[data-link-id], [data-beacon-id]")) {
        const zoneId = target.closest<HTMLElement>("[data-zone-id]")?.dataset.zoneId ??
          hitTestZones(world, zones.byId, zones.order);
        if (zoneId && zones.byId[zoneId]) {
          if (event.ctrlKey) toggleZoneUndoable(zoneId);
          else {
            changeSelectionUndoable((next) => {
              if (!next.zoneIds.includes(zoneId)) {
                next.ids = [];
                next.primaryId = null;
                next.zoneIds = [zoneId];
              } else {
                next.zoneIds = [...next.zoneIds.filter((id) => id !== zoneId), zoneId];
              }
            }, undefined, true);
            startZoneMove(event, zoneId, local, world, event.shiftKey);
          }
          return;
        }
      }

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

      if (
        pendingAltContextPick?.pointerId === event.pointerId &&
        crossedGestureThreshold(pendingAltContextPick.startScreen, local)
      ) {
        pendingAltContextPick = null;
      }

      if (activeGesture && activeGesture.pointerId === event.pointerId) {
        updatePointerGesture(event, local);
        return;
      }

      // A middle-button pan remains owned by the camera while G move mode is active.
      if (grabGesture && event.buttons === 0 && isPointInsideBoard(local)) {
        updateGrabAt(screenToWorld(camera, viewport, local), event.ctrlKey, event.altKey);
      }
    }

    function onPointerUp(event: PointerEvent): void {
      const local = localPoint(event);
      if (
        pendingAltContextPick?.pointerId === event.pointerId && local &&
        crossedGestureThreshold(pendingAltContextPick.startScreen, local)
      ) {
        pendingAltContextPick = null;
      }
      if (activeGesture?.pointerId !== event.pointerId) {
        completePendingAltContextPick(event.pointerId, false);
        return;
      }
      if (local) updatePointerGesture(event, local, false);
      finishPointerGesture(event.pointerId, false);
    }

    function onPointerCancel(event: PointerEvent): void {
      if (activeGesture?.pointerId === event.pointerId) finishPointerGesture(event.pointerId, true);
      else completePendingAltContextPick(event.pointerId, true);
    }

    function onLostPointerCapture(event: PointerEvent): void {
      if (activeGesture?.pointerId === event.pointerId) finishPointerGesture(event.pointerId, true, false);
    }

    function onClick(event: MouseEvent): void {
      if (suppressBodyClickUntil > performance.now()) {
        suppressBodyClickUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (
        !target ||
        event.altKey ||
        target.closest(
          ".selection-context-pick, [data-create-menu], [data-selection-ignore], [data-note-header], [data-resize-handle], [data-group-scale-handle]",
        )
      ) return;

      const body = target.closest("[data-note-body]");
      const noteRoot = body?.closest<HTMLElement>("[data-note-id]") ?? target.closest<HTMLElement>("[data-note-id]");
      const id = noteRoot?.dataset.noteId;
      if (!id || !boardState.notes[id] || isDimmed(id)) return;

      if (editing.noteId === id) {
        changeSelectionUndoable(() => undefined, undefined, true);
        ensureEditingSelection(id);
        return;
      }

      if (event.ctrlKey) toggleNoteUndoable(id);
      else if (selection.ids.includes(id)) {
        changeSelectionUndoable(() => undefined, undefined, true);
        ensureEditingSelection(id);
      } else selectNoteUndoable(id);
    }

    function onDoubleClick(event: MouseEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const body = target.closest("[data-note-body]");
      const handle = target?.closest<HTMLElement>(
        '[data-resize-handle="bottom"], [data-resize-handle="top"]',
      );
      if (handle) {
        const id = handle.dataset.noteId;
        const note = id ? boardState.notes[id] : undefined;
        if (!id || !note) return;

        const body = Array.from(boardEl.querySelectorAll<HTMLElement>(".note-card[data-note-id]"))
          .find((element) => element.dataset.noteId === id)
          ?.querySelector<HTMLElement>("[data-note-body]");
        const rect = body?.getBoundingClientRect();
        const insideBody = rect !== undefined &&
          event.clientX >= rect.left && event.clientX < rect.right &&
          event.clientY >= rect.top && event.clientY < rect.bottom;
        const canEdit = note.type === "note" || note.type === "pro" || note.type === "con";
        const metrics = renderedNoteMetrics(id);
        const autoHeightWithinLimit = !metrics ||
          metrics.contentHeight <= maximumResizableHeight(metrics.contentHeight, metrics.lineHeight);
        const action = resizeDoubleClickAction(
          handle.dataset.resizeHandle as ResizeEdge,
          canEdit && insideBody,
          !isStandaloneModuleKind(note.type),
          autoHeightWithinLimit,
        );
        if (action === "edit") {
          event.preventDefault();
          event.stopPropagation();
          ensureEditingSelection(id);
          tool.active = "select";
          startNoteEditing(id, { x: event.clientX, y: event.clientY });
        } else if (action === "auto-height" && note.height !== null) {
          event.preventDefault();
          event.stopPropagation();
          const before = frameForNote(id);
          const after = { ...before, height: null };
          execute(geometryCommand("Resize", note.name, [before], [after]));
        }
        return;
      }

      const noteRoot = body?.closest<HTMLElement>("[data-note-id]");
      const editingId = noteRoot?.dataset.noteId;
      if (editingId && boardState.notes[editingId]) ensureEditingSelection(editingId);
    }

    function onContextMenu(event: MouseEvent): void {
      if (!grabGesture && performance.now() > suppressContextMenuUntil) return;
      suppressContextMenuUntil = 0;
      event.preventDefault();
      event.stopPropagation();
      if (grabGesture) cancelGrab();
    }

    function onNativeDragStart(event: DragEvent): void {
      if (activeGesture?.kind !== "body-move" || !activeGesture.started) return;
      event.preventDefault();
    }

    function onPrecisionKeyDown(event: KeyboardEvent): void {
      if (!isAltKey(event)) return;
      altHeld = true;
      if (activeGesture || grabGesture) event.preventDefault();
      rebasePrecision(true);
    }

    function onPrecisionKeyUp(event: KeyboardEvent): void {
      if (!isAltKey(event)) return;
      altHeld = event.altKey;
      rebasePrecision(altHeld);
    }

    boardEl.addEventListener("pointerdown", onPointerDown, true);
    boardEl.addEventListener("dragstart", onNativeDragStart, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    boardEl.addEventListener("lostpointercapture", onLostPointerCapture, true);
    boardEl.addEventListener("click", onClick, true);
    boardEl.addEventListener("dblclick", onDoubleClick, true);
    boardEl.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onPrecisionKeyDown, true);
    window.addEventListener("keyup", onPrecisionKeyUp, true);

    const detachController = attachSelectionController({ escape, startGrab });

    function onWindowBlur(): void {
      if (activeGesture) finishPointerGesture(activeGesture.pointerId, true);
      if (grabGesture) cancelGrab();
      altHeld = false;
    }

    window.addEventListener("blur", onWindowBlur);

    return () => {
      if (activeGesture) finishPointerGesture(activeGesture.pointerId, true);
      if (grabGesture) cancelGrab();
      detachController();
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("keydown", onPrecisionKeyDown, true);
      window.removeEventListener("keyup", onPrecisionKeyUp, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      boardEl.removeEventListener("pointerdown", onPointerDown, true);
      boardEl.removeEventListener("dragstart", onNativeDragStart, true);
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
    return {
      ...boundsAsFrame(id, bounds, note.height),
      type: note.type,
      widthLocked: note.widthLocked ?? false,
      maxWidth: maximumWidthForKind(note.type),
      maxHeight: maximumResizableHeightForNote(id),
    };
  }

  function startMove(
    event: PointerEvent,
    screen: Point,
    world: Point,
    frames: NoteFrame[],
    anchorId: string,
    toggleOnClickId: string | null = null,
  ): void {
    activeGesture = {
      kind: "move",
      pointerId: event.pointerId,
      startScreen: screen,
      precision: createPrecisionDeltaTracker(world, event.altKey),
      started: false,
      captured: false,
      gesture: createMoveGesture(frames, anchorId, world),
      toggleOnClickId,
    };
  }

  function startBodyMove(
    event: PointerEvent,
    screen: Point,
    world: Point,
    noteId: string,
    noteElement: HTMLElement,
  ): void {
    activeGesture = {
      kind: "body-move",
      pointerId: event.pointerId,
      startScreen: screen,
      startWorld: world,
      precision: createPrecisionDeltaTracker(world, event.altKey),
      noteId,
      noteElement,
      previousUserSelect: noteElement.style.userSelect,
      started: false,
      captured: false,
      gesture: null,
    };
    // The static note body is a move surface; active editor text remains untouched.
    noteElement.style.userSelect = "none";
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
      precision: createPrecisionDeltaTracker(world, event.altKey),
      started: false,
      captured: false,
      gesture: createResizeGesture(
        frameForNote(id), noteBounds(note).height, edge, world, isStandaloneModuleKind(note.type),
      ),
    };
  }

  function startGroupScale(
    event: PointerEvent,
    edge: ResizeEdge,
    screen: Point,
    world: Point,
    frames: NoteFrame[],
    bounds: Bounds,
  ): void {
    closeContextPick();
    activeGesture = {
      kind: "group-scale",
      pointerId: event.pointerId,
      startScreen: screen,
      precision: createPrecisionDeltaTracker(world, event.altKey),
      started: false,
      captured: false,
      gesture: createGroupScaleGesture(
        frames,
        bounds,
        edge,
        world,
        new Set(frames.filter((frame) => isStandaloneModuleKind(boardState.notes[frame.id]?.type)).map((frame) => frame.id)),
        new Set(frames.filter((frame) => boardState.notes[frame.id]?.type === "beacon").map((frame) => frame.id)),
      ),
    };
  }

  function startZoneMove(
    event: PointerEvent,
    id: string,
    screen: Point,
    world: Point,
    carryMembers: boolean,
  ): void {
    const zone = zones.byId[id];
    if (!zone) return;
    const members: MemberPosition[] = carryMembers
      ? zoneMembers(id).flatMap((memberId) => {
        const note = boardState.notes[memberId];
        return note ? [{ id: memberId, x: note.x, y: note.y }] : [];
      })
      : [];
    activeGesture = {
      kind: "zone-move",
      pointerId: event.pointerId,
      startScreen: screen,
      precision: createPrecisionDeltaTracker(world, event.altKey),
      started: false,
      captured: false,
      gesture: createZoneMoveGesture(
        zone, Object.values(zones.byId).filter((other) => other.id !== id), members, world,
      ),
    };
  }

  function startZoneResize(
    event: PointerEvent,
    id: string,
    edge: ResizeEdge,
    screen: Point,
    world: Point,
  ): void {
    const zone = zones.byId[id];
    if (!zone || !isRectZone(zone)) return;
    activeGesture = {
      kind: "zone-resize",
      pointerId: event.pointerId,
      startScreen: screen,
      precision: createPrecisionDeltaTracker(world, event.altKey),
      started: false,
      captured: false,
      gesture: createZoneResizeGesture(
        zone, Object.values(zones.byId).filter((other) => other.id !== id), edge, world,
      ),
    };
  }

  function updatePointerGesture(event: PointerEvent, screen: Point, captureForFollowup = true): void {
    const gesture = activeGesture;
    if (!gesture) return;

    const world = screenToWorld(camera, viewport, screen);

    if (gesture.kind === "marquee") {
      if (!gesture.started && !crossedGestureThreshold(gesture.startScreen, screen)) return;
      if (!gesture.captured && captureForFollowup) {
        capturePointer(event.pointerId);
        gesture.captured = true;
      }
      gesture.started = true;
      setMarquee(rectFromPoints(gesture.startWorld, world));
      return;
    }

    // Keep the last pointer position current before the drag threshold too, so an
    // Alt toggle during that interval rebases at the actual cursor location.
    const precision = updatePrecisionDelta(gesture.precision, world, event.altKey);
    gesture.precision = precision.tracker;
    const thresholdCrossed = crossedGestureThreshold(gesture.startScreen, screen);
    const shouldStart = gesture.kind === "body-move"
      ? noteMoveStarts("move-candidate", thresholdCrossed)
      : thresholdCrossed;
    if (!gesture.started && !shouldStart) return;
    if (!gesture.captured && captureForFollowup) {
      capturePointer(event.pointerId);
      gesture.captured = true;
    }
    const justStarted = !gesture.started;
    gesture.started = true;

    if (justStarted && gesture.kind === "move" && gesture.toggleOnClickId) {
      setPrimaryUndoable(gesture.toggleOnClickId);
    }

    if (gesture.kind === "body-move") {
      event.preventDefault();
      if (!gesture.gesture) {
        if (event.ctrlKey) {
          if (!selection.ids.includes(gesture.noteId)) toggleNoteUndoable(gesture.noteId);
        } else if (selection.ids.includes(gesture.noteId)) {
          setPrimaryUndoable(gesture.noteId);
        } else {
          selectNoteUndoable(gesture.noteId);
        }
        const frames = framesForSelection();
        if (frames.length === 0) return;
        gesture.gesture = createMoveGesture(frames, gesture.noteId, gesture.startWorld);
      }
      const adjustedWorld = addPoint(gesture.startWorld, precision.delta);
      gesture.gesture = updateMoveGesture(
        gesture.gesture,
        adjustedWorld,
        grid.snap || event.ctrlKey,
        grid.step,
      );
      applyFrames(gesture.gesture.after);
      updateModulePreview(gesture.gesture.before, world);
      return;
    }

    const adjustedWorld = addPoint(gesture.gesture.startWorld, precision.delta);

    if (gesture.kind === "zone-move") {
      gesture.gesture = updateZoneMoveGesture(
        gesture.gesture, adjustedWorld, grid.snap || event.ctrlKey, grid.step,
      );
      applyZoneMove(gesture.gesture.afterZone, gesture.gesture.afterMembers);
      zoneCollisionHint = gesture.gesture.blocked;
      return;
    }

    if (gesture.kind === "zone-resize") {
      gesture.gesture = updateZoneResizeGesture(
        gesture.gesture, adjustedWorld, grid.snap || event.ctrlKey, grid.step,
      );
      applyZoneGeometry(gesture.gesture.afterZone);
      zoneCollisionHint = gesture.gesture.blocked;
      return;
    }

    if (gesture.kind === "move") {
      gesture.gesture = updateMoveGesture(
        gesture.gesture,
        adjustedWorld,
        grid.snap || event.ctrlKey,
        grid.step,
      );
      applyFrames(gesture.gesture.after);
      updateModulePreview(gesture.gesture.before, world);
      return;
    }

    if (gesture.kind === "resize") {
      gesture.gesture = updateResizeGesture(
        gesture.gesture,
        adjustedWorld,
        grid.snap || event.ctrlKey,
        grid.step,
      );
      applyFrames([gesture.gesture.after]);
      return;
    }

    gesture.gesture = updateGroupScaleGesture(
      gesture.gesture,
      adjustedWorld,
      grid.snap || event.ctrlKey,
      grid.step,
      event.shiftKey,
    );
    applyFrames(gesture.gesture.after);
  }

  function finishPointerGesture(pointerId: number, cancelled: boolean, release = true): void {
    const gesture = activeGesture;
    if (!gesture || gesture.pointerId !== pointerId) return;
    activeGesture = null;
    zoneCollisionHint = false;

    if (gesture.kind === "marquee") {
      const marquee = selection.marquee;
      if (cancelled) {
        setMarquee(null);
      } else if (gesture.started && marquee) {
        const zoneIds = zonesTouchingMarquee(marquee, zones.byId, zones.order);
        const ids = notesTouchingMarquee(marquee, boardState.notes, boardState.order, noteBounds, (id) => !isDimmed(id));
        changeSelectionUndoable((next) => {
          if (!gesture.additive) {
            next.ids = [...ids];
            next.zoneIds = [...zoneIds];
            next.primaryId = ids.at(-1) ?? null;
            return;
          }
          const merged = [...next.ids];
          for (const id of ids) if (!merged.includes(id)) merged.push(id);
          next.ids = merged;
          next.zoneIds = [...new Set([...next.zoneIds, ...zoneIds])];
          if (ids.length > 0) next.primaryId = ids.at(-1) ?? null;
        }, undefined, true);
        setMarquee(null);
      } else {
        setMarquee(null);
        if (!gesture.additive) clearSelectionUndoable();
      }
    } else if (gesture.kind === "move") {
      if (cancelled) {
        applyFrames(cancelMoveGesture(gesture.gesture));
      } else if (gesture.started) {
        commitMoveGesture(gesture.gesture, gesture.precision.pointer);
      } else if (
        gesture.toggleOnClickId &&
        shouldToggleSelectedHeaderAfterGesture(gesture.started, cancelled)
      ) {
        toggleNoteUndoable(gesture.toggleOnClickId);
      }
    } else if (gesture.kind === "body-move") {
      if (gesture.gesture) {
        if (cancelled) {
          applyFrames(cancelMoveGesture(gesture.gesture));
        } else if (gesture.started) {
          commitMoveGesture(gesture.gesture, gesture.precision.pointer);
        }
      }
      gesture.noteElement.style.userSelect = gesture.previousUserSelect;
      if (gesture.started && !cancelled) {
        suppressBodyClickUntil = performance.now() + 500;
      }
    } else if (gesture.kind === "resize") {
      if (cancelled) {
        applyFrames([cancelResizeGesture(gesture.gesture)]);
      } else if (gesture.started) {
        const change = resizeGestureChange(gesture.gesture);
        if (change) {
          const note = boardState.notes[change.before[0].id];
          recordGeometryChange("Resize", note?.name ?? "", change);
        }
      }
    } else if (gesture.kind === "zone-move") {
      if (cancelled) {
        applyZoneMove(gesture.gesture.beforeZone, gesture.gesture.beforeMembers);
      } else if (gesture.started && zoneGestureChanged(gesture.gesture.beforeZone, gesture.gesture.afterZone)) {
        const beforeZone = gesture.gesture.beforeZone;
        const afterZone = gesture.gesture.afterZone;
        const beforeMembers = gesture.gesture.beforeMembers;
        const afterMembers = gesture.gesture.afterMembers;
        record({
          label: "Move zone",
          target: beforeZone.name,
          do: () => applyZoneMove(afterZone, afterMembers),
          undo: () => applyZoneMove(beforeZone, beforeMembers),
        });
      }
    } else if (gesture.kind === "zone-resize") {
      if (cancelled) {
        applyZoneGeometry(gesture.gesture.beforeZone);
      } else if (gesture.started && zoneGestureChanged(gesture.gesture.beforeZone, gesture.gesture.afterZone)) {
        const beforeZone = gesture.gesture.beforeZone;
        const afterZone = gesture.gesture.afterZone;
        record({
          label: "Resize zone",
          target: beforeZone.name,
          do: () => applyZoneGeometry(afterZone),
          undo: () => applyZoneGeometry(beforeZone),
        });
      }
    } else if (cancelled) {
      applyFrames(cancelGroupScaleGesture(gesture.gesture));
    } else if (gesture.started) {
      const change = groupScaleGestureChange(gesture.gesture);
      if (change) recordGeometryChange("Scale", `${change.before.length} notes`, change);
    }

    clearModuleDropPreview();
    completePendingAltContextPick(pointerId, !cancelled);

    if (release) releasePointer(pointerId);
  }

  function updateGrabAt(world: Point, ctrlHeld: boolean, alt = altHeld): void {
    if (!grabGesture) return;
    if (!grabStartWorld) {
      grabStartWorld = { ...world };
      grabGesture = createMoveGesture(grabGesture.before, grabGesture.anchorId, world);
      grabPrecision = createPrecisionDeltaTracker(world, alt);
      return;
    }

    if (!grabPrecision) grabPrecision = createPrecisionDeltaTracker(grabStartWorld, alt);
    const precision = updatePrecisionDelta(grabPrecision, world, alt);
    grabPrecision = precision.tracker;
    grabGesture = updateMoveGesture(
      grabGesture,
      addPoint(grabGesture.startWorld, precision.delta),
      grid.snap || ctrlHeld,
      grid.step,
    );
    applyFrames(grabGesture.after);
    updateModulePreview(grabGesture.before, world);
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
    grabPrecision = pointer.world ? createPrecisionDeltaTracker(pointer.world, altHeld) : null;
    selection.grabActive = true;
  }

  function commitGrab(world: Point): void {
    if (!grabGesture) return;
    commitMoveGesture(grabGesture, world);
    clearModuleDropPreview();
    grabGesture = null;
    grabStartWorld = null;
    grabPrecision = null;
    selection.grabActive = false;
  }

  function cancelGrab(): void {
    if (!grabGesture) return;
    applyFrames(cancelMoveGesture(grabGesture));
    clearModuleDropPreview();
    grabGesture = null;
    grabStartWorld = null;
    grabPrecision = null;
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
    clearSelectionUndoable();
  }

  function completePendingAltContextPick(pointerId: number, open: boolean): void {
    const pending = pendingAltContextPick;
    if (!pending || pending.pointerId !== pointerId) return;
    pendingAltContextPick = null;
    selection.ids = [...pending.selectedIds];
    selection.primaryId = pending.primaryId;
    if (open) setContextPick(pending.noteIds, pending.point, viewport);
  }

  function selectNoteUndoable(noteId: string): void {
    changeSelectionUndoable((next) => {
      next.ids = [noteId];
      next.zoneIds = [];
      next.primaryId = noteId;
    }, undefined, true);
  }

  function toggleNoteUndoable(noteId: string): void {
    changeSelectionUndoable((next) => {
      if (next.ids.includes(noteId)) {
        next.ids = next.ids.filter((id) => id !== noteId);
        if (next.primaryId === noteId) next.primaryId = next.ids.at(-1) ?? null;
      } else {
        next.ids = [...next.ids, noteId];
        next.primaryId = noteId;
      }
    }, undefined, true);
  }

  function setPrimaryUndoable(noteId: string): void {
    changeSelectionUndoable((next) => {
      if (next.ids.includes(noteId)) next.primaryId = noteId;
    }, undefined, true);
  }

  function toggleZoneUndoable(zoneId: string): void {
    changeSelectionUndoable((next) => {
      next.zoneIds = next.zoneIds.includes(zoneId)
        ? next.zoneIds.filter((id) => id !== zoneId)
        : [...next.zoneIds, zoneId];
    }, undefined, true);
  }

  function ensureEditingSelection(noteId: string): void {
    const next = selectionForEditing(selection, noteId);
    const unchanged =
      selection.primaryId === next.primaryId &&
      selection.ids.length === next.ids.length &&
      selection.ids.every((id, index) => id === next.ids[index]);
    if (unchanged) return;

    selection.ids = next.ids;
    selection.primaryId = next.primaryId;
  }

  function rebasePrecision(alt: boolean): void {
    const gesture = activeGesture;
    if (gesture && gesture.kind !== "marquee") gesture.precision = setPrecisionAlt(gesture.precision, alt);
    if (grabPrecision) grabPrecision = setPrecisionAlt(grabPrecision, alt);
  }

  function isAltKey(event: KeyboardEvent): boolean {
    return event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight";
  }

  function addPoint(point: Point, delta: Point): Point {
    return { x: point.x + delta.x, y: point.y + delta.y };
  }

  function applyFrames(frames: readonly NoteFrame[]): void {
    for (const frame of frames) {
      updateNote(frame.id, { x: frame.x, y: frame.y, width: frame.width, height: frame.height });
    }
  }

  function applyZoneGeometry(zone: Zone): void {
    updateZone(zone.id, {
      parts: zone.parts.map((part) => part.map((point) => ({ ...point }))),
      holes: zone.holes.map((hole) => hole.map((point) => ({ ...point }))),
    });
  }

  function applyZoneMove(zone: Zone, members: readonly MemberPosition[]): void {
    applyZoneGeometry(zone);
    for (const member of members) updateNote(member.id, { x: member.x, y: member.y });
  }

  function commitMoveGesture(gesture: MoveGesture, worldPoint: Point): void {
    const movedTypes = gesture.before.map((frame) => boardState.notes[frame.id]?.type ?? "note");
    const initialDecision = resolveModuleDropDecision(movedTypes, false);
    const moduleId = initialDecision.tryInsert && gesture.before.length === 1
      ? gesture.before[0].id
      : null;
    let inserted = false;
    if (moduleId) {
      // Insert from the module's pre-drag position so Undo brings it back where it was dragged from.
      const dropped = boardState.notes[moduleId];
      const droppedFrame = dropped
        ? { id: moduleId, x: dropped.x, y: dropped.y, width: dropped.width, height: dropped.height }
        : null;
      applyFrames(gesture.before);
      inserted = tryInsertModuleOnDrop(moduleId, worldPoint);
      if (!inserted && droppedFrame) applyFrames([droppedFrame]);
    }
    const decision = resolveModuleDropDecision(movedTypes, false, inserted);
    if (!decision.commitMove) return;

    const change = moveGestureChange(gesture);
    if (change) recordGeometryChange("Move", targetForMove(change.before, gesture.anchorId), change);
  }

  function updateModulePreview(frames: readonly NoteFrame[], worldPoint: Point): void {
    if (frames.length !== 1) return;
    const note = boardState.notes[frames[0].id];
    if (note?.type === "importance" || note?.type === "purpose" || note?.type === "mood") {
      updateModuleDropPreview(note.id, worldPoint);
    }
  }

  function targetForMove(frames: readonly NoteFrame[], anchorId: string): string {
    if (frames.length !== 1) return `${frames.length} notes`;
    return boardState.notes[anchorId]?.name ?? boardState.notes[frames[0]?.id ?? ""]?.name ?? "";
  }

  function recordGeometryChange(label: "Move" | "Resize" | "Scale", target: string, change: GeometryChange): void {
    record(geometryCommand(label, target, change.before, change.after));
  }

  function geometryCommand(
    label: "Move" | "Resize" | "Scale",
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
    if (boardState.notes[id]) selectNoteUndoable(id);
    closeContextPick();
  }

  function handleLabel(edge: ResizeEdge): string {
    return edge.replaceAll("-", " ");
  }

  function isCornerHandle(edge: ResizeEdge): boolean {
    const axes = resizeEdgeAxes(edge);
    return axes.horizontal !== null && axes.vertical !== null;
  }

  function resizeHandleTitle(edge: ResizeEdge, standaloneModule = false): string {
    if (standaloneModule) {
      return `Resize height from ${edge.startsWith("top") ? "top" : "bottom"}`;
    }
    const base = `Resize from ${handleLabel(edge)}`;
    return edge === "top" || edge === "bottom" ? `${base}; double-click for auto height` : base;
  }

  function groupHandleTitle(edge: ResizeEdge): string {
    const base = `Scale selection from ${handleLabel(edge)}`;
    return isCornerHandle(edge) ? `${base}; hold Shift to preserve aspect ratio` : base;
  }
</script>

<div class="selection-layer" class:line-tool-active={lineToolActive} bind:this={layer} aria-hidden="false">
  {#each zoneOutlines as outline (outline.id)}
    <div
      class="selection-outline selection-zone-outline"
      role="group"
      data-selected="true"
      data-primary={outline.primary ? "true" : undefined}
      data-zone-id={outline.id}
      style:left="{outline.left}px"
      style:top="{outline.top}px"
      style:width="{outline.width}px"
      style:height="{outline.height}px"
      style:outline-color={outline.color}
      style={`--zone-handle-color: ${outline.color}`}
      aria-label="Selected zone {outline.name}"
    >
      {#if outline.primary && outline.resizable}
        {#each RESIZE_EDGES as edge (edge)}
          <button
            class={`resize-handle resize-handle-${edge} zone-resize-handle`}
            class:resize-handle-corner={isCornerHandle(edge)}
            class:resize-handle-side={!isCornerHandle(edge)}
            type="button"
            data-zone-resize-handle={edge}
            data-zone-id={outline.id}
            aria-disabled={lineToolActive ? "true" : undefined}
            tabindex={lineToolActive ? -1 : undefined}
            aria-label="Resize zone {outline.name} from {handleLabel(edge)}"
            title="Resize zone from {handleLabel(edge)}"
          ></button>
        {/each}
      {/if}
    </div>
  {/each}

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
      style:border-radius={outline.kind === "beacon" ? undefined : noteOutlineCornerRadius}
      aria-label="Selected {outline.name}"
    >
      {#if selection.ids.length === 1 && selection.zoneIds.length === 0 && outline.primary}
        {#each RESIZE_EDGES.filter((edge) => hasResizeHandle(outline.kind, edge, outline.widthLocked)) as edge (edge)}
          <button
            class={`resize-handle resize-handle-${edge}`}
            class:resize-handle-corner={isCornerHandle(edge)}
            class:resize-handle-side={!isCornerHandle(edge)}
            class:module-vertical-handle={isStandaloneModuleKind(outline.kind) && isCornerHandle(edge)}
            type="button"
            data-resize-handle={edge}
            data-note-id={outline.id}
            aria-disabled={lineToolActive ? "true" : undefined}
            tabindex={lineToolActive ? -1 : undefined}
            aria-label={isStandaloneModuleKind(outline.kind)
              ? `Resize ${outline.name} height from ${edge.startsWith("top") ? "top" : "bottom"}`
              : `Resize ${outline.name} from ${handleLabel(edge)}`}
            title={resizeHandleTitle(edge, isStandaloneModuleKind(outline.kind))}
          ></button>
        {/each}
      {/if}
    </div>
  {/each}

  {#if groupOutline}
    <div
      class="selection-outline selection-group-outline"
      data-selected="true"
      data-selection-group="true"
      style:left="{groupOutline.left}px"
      style:top="{groupOutline.top}px"
      style:width="{groupOutline.width}px"
      style:height="{groupOutline.height}px"
      style:border-radius="5px"
      role="group"
      aria-label="Selection bounds for {selection.ids.length} notes"
    >
      {#each RESIZE_EDGES as edge (edge)}
        <button
          class={`resize-handle resize-handle-${edge}`}
          class:resize-handle-corner={isCornerHandle(edge)}
          class:resize-handle-side={!isCornerHandle(edge)}
          type="button"
          data-group-scale-handle={edge}
          aria-disabled={lineToolActive ? "true" : undefined}
          tabindex={lineToolActive ? -1 : undefined}
          aria-label="Scale selected notes from {handleLabel(edge)}"
          title={groupHandleTitle(edge)}
        ></button>
      {/each}
    </div>
  {/if}

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

  {#if zoneCollisionHint}
    <div class="zone-collision-hint" role="status">Zone stopped by another zone</div>
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
    box-sizing: border-box;
    border: 0;
    outline: 1px solid var(--accent);
    outline-offset: 1px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }

  .selection-outline[data-primary="true"] {
    outline-width: 1.5px;
  }

  .selection-layer.line-tool-active .resize-handle {
    cursor: crosshair;
  }

  .selection-layer.line-tool-active .resize-handle:hover::before {
    background: var(--accent);
  }

  .selection-group-outline {
    outline-style: dashed;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
  }

  .selection-zone-outline {
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
  }

  .zone-resize-handle {
    outline: none;
  }

  .zone-resize-handle:focus-visible {
    outline: 1px solid var(--zone-handle-color);
    outline-offset: 1px;
  }

  .resize-handle {
    position: absolute;
    z-index: 1;
    display: block;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    pointer-events: auto;
    touch-action: none;
  }

  .resize-handle::before {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 8px;
    height: 8px;
    box-sizing: border-box;
    border: 1px solid #191919;
    border-radius: 50%;
    background: var(--accent);
    content: "";
  }

  .resize-handle-corner::before {
    border-radius: 0;
  }

  .zone-resize-handle::before {
    background: var(--zone-handle-color);
  }

  .resize-handle:hover::before,
  .resize-handle:focus-visible::before {
    background: #ffd260;
  }

  .resize-handle-top-left {
    top: -16px;
    left: -16px;
    cursor: nwse-resize;
  }

  .resize-handle-top {
    top: -16px;
    left: 50%;
    transform: translateX(-50%);
    cursor: ns-resize;
  }

  .resize-handle-top-right {
    top: -16px;
    right: -16px;
    cursor: nesw-resize;
  }

  .resize-handle-right {
    top: 50%;
    right: -16px;
    transform: translateY(-50%);
    cursor: ew-resize;
  }

  .resize-handle-bottom-right {
    right: -16px;
    bottom: -16px;
    cursor: nwse-resize;
  }

  .resize-handle-bottom {
    bottom: -16px;
    left: 50%;
    transform: translateX(-50%);
    cursor: ns-resize;
  }

  .resize-handle-bottom-left {
    bottom: -16px;
    left: -16px;
    cursor: nesw-resize;
  }

  .resize-handle-left {
    top: 50%;
    left: -16px;
    transform: translateY(-50%);
    cursor: ew-resize;
  }

  .module-vertical-handle {
    cursor: ns-resize;
  }

  .marquee {
    position: absolute;
    border: 1px solid rgba(232, 176, 48, 0.95);
    background: rgba(232, 176, 48, 0.12);
  }

  .zone-collision-hint {
    position: absolute;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    border: 1px solid #765d2b;
    border-radius: 3px;
    background: rgba(35, 35, 35, 0.9);
    color: var(--text);
    font-size: 11px;
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
