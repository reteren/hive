<!-- Screen-space selection outlines and pointer gestures for board notes (R1.4). -->
<script lang="ts">
  import { onMount } from "svelte";
  import { board as boardState, updateNote } from "../model/board.svelte";
  import { camera, pointer, viewport } from "../board/camera.svelte";
  import { pixelsPerUnit, screenToWorld, worldToScreen, type Point } from "../board/cameraMath";
  import { boardPopupStyle, dismissBoardPopup } from "../ui/boardAnchor";
  import { grid } from "../board/grid.svelte";
  import { execute, record, type HistoryCommand } from "../history/history.svelte";
  import { editing } from "../notes/editing.svelte";
  import { normalizeNoteScale, type NoteKind } from "../model/note";
  import { geometryFromListStatisticsFrame, listStatisticsFrameLimits, listStatisticsWidth } from "../stats/listStatsLayout";
  import { raiseMovingCards } from "../stats/movingCards";
import { MIN_NOTE_WIDTH, maximumResizableHeight, maximumResizableHeightForNote, minimumTextWidthForNote, noteBounds, renderedNoteMetrics, type Bounds } from "../notes/layout.svelte";
import { preferences } from "../settings/preferences.svelte";
import { inboxAutoHeight, inboxMinHeight } from "../inbox/inboxLayout";
import { userDictionary } from "../spell/dictionary.svelte";
import { measureDictionaryHeightLimits } from "../spell/dictionarySizing";
  import { zoneBounds, type Zone } from "../model/zone";
  import { zones, updateZone } from "../model/zones.svelte";
  import { beginZoneMembershipBatch, endZoneMembershipBatch, zoneMembers } from "../zones/membership.svelte";
  import { isDimmed } from "../beacons/focus.svelte";
  import {
    createZoneMoveGesture,
    createZoneResizeGesture,
    cancelZoneMoveGesture,
    isRectZone,
    updateZoneMoveGesture,
    updateZoneResizeGesture,
    zoneGestureChanged,
    zoneMoveHistoryCommand,
    type MemberPosition,
    type ZoneMoveGesture,
    type ZoneResizeGesture,
  } from "../zones/zoneGestures";
  import { isTextEditingTarget } from "../commands/focus";
  import { commands } from "../commands/registry.svelte";
  import { findMatchingCommand } from "../commands/keys";
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
    normalizeScaleResizeAtCommit,
    cancelScaleModeGesture,
    createScaleModeGesture,
    geometryHistoryCommand,
    normalizeScaleModeAtCommit,
    resizeGestureChange,
    scaleModeGestureChange,
    scaleModeKeyAction,
    scaleModePointerAction,
    shouldShowResizeHandle,
    shouldCancelForLineTool,
    updateScaleModeGesture,
    updateMoveGesture,
    updateResizeGesture,
    type GeometryChange,
    type MoveGesture,
    type NoteFrame,
    type ResizeGesture,
    type ScaleModeGesture,
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
    notifySelectionInteraction,
    selection,
    setContextPick,
    setMarquee,
  } from "./selection.svelte";
  import { selectionForEditing } from "./editingSelection";
  import {
    noteMoveStarts,
    notePressIntent,
    shouldSelectNoteOnAltPress,
    shouldSuppressAltNodeActivationClick,
    shouldToggleSelectedHeaderAfterGesture,
  } from "./noteMoveIntent";
  import { hasResizeHandle, isFixedSizeNodeKind, isStandaloneModuleKind, maximumWidthForKind, minimumHeightForKind, RESIZE_EDGES, resizeEdgeAxes, type ResizeEdge } from "./resize";
  import { resizeDoubleClickAction } from "./resizeDoubleClick";
  import { startNoteEditing } from "../editor/editorSession";
import { isLineTool, tool } from "../tools/tool.svelte";
import { takeZoneMoveRequest, zoneMode } from "../zones/zoneMode.svelte";
import { clearZoneMovePreview, setZoneMovePreview, zoneMovePreview } from "../zones/zoneMovePreview.svelte";
  import {
    createPrecisionDeltaTracker,
    setPrecisionAlt,
    updatePrecisionDelta,
    type PrecisionDeltaTracker,
  } from "./precision";
  import { resolveModuleDropDecision } from "./moduleDropDecision";
  import { clearDropTargetPreview, dropOnTarget, previewDropTarget } from "./dropTargets";

  interface Outline {
    id: string;
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
    primary: boolean;
    kind: NoteKind;
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
    path: string;
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

  type GesturePointerInput = Pick<PointerEvent, "pointerId" | "altKey" | "ctrlKey" | "shiftKey" | "preventDefault">;

type PendingBoardMove =
    | { kind: "gesture"; pointerId: number; screen: Point; event: GesturePointerInput }
    | { kind: "zone-grab" | "grab" | "scale-mode"; pointerId: number; world: Point; ctrl: boolean; alt: boolean };

  let layer: HTMLDivElement;
  let boardElement: HTMLElement | null = null;
  let activeGesture: ActivePointerGesture | null = null;
  let grabGesture: MoveGesture | null = null;
  let scaleModeGesture = $state<ScaleModeGesture | null>(null);
  let transformModeHint = $state<"Move" | "Scale" | null>(null);
  let shiftHeld = $state(false);
  let zoneGrabGesture: ZoneMoveGesture | null = null;
  let zoneGrabStartWorld: Point | null = null;
  let zoneGrabPrecision: PrecisionDeltaTracker | null = null;
  let zoneMembershipBatchOpen = false;
  let pointerMoveFrame: number | null = null;
  let pendingBoardMove: PendingBoardMove | null = null;
  let grabStartWorld: Point | null = null;
  let grabPrecision: PrecisionDeltaTracker | null = null;
  let pendingAltContextPick: PendingAltContextPick | null = null;
  let pendingAltNodeActivationPointerId: number | null = null;
  const zoneOutlinePathCache = new WeakMap<Zone, {
    parts: Zone["parts"];
    holes: Zone["holes"];
    ppu: number;
    value: string;
  }>();
  let altHeld = false;
  let suppressContextMenuUntil = 0;
  let suppressBodyClickUntil = 0;
  let suppressAltNodeClickUntil = 0;
  let restoreMovingStacking: (() => void) | null = null;
  let zoneCollisionHint = $state(false);
  let lineToolActive = $derived(isLineTool());
  let noteOutlineCornerRadius = $derived(`${noteSelectionCornerRadius(camera.zoom)}px`);
  let previousTool = tool.active;
  let previousZoneFinishRequest = zoneMode.finishRequest;

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
      const offset = zoneMovePreview.zoneId === id ? zoneMovePreview.offset : { x: 0, y: 0 };
      const screen = worldToScreen(camera, viewport, { x: bounds.x + offset.x, y: bounds.y + offset.y });
      return [{
        id, name: zone.name, color: zone.color,
        left: screen.x, top: screen.y,
        width: bounds.width * ppu, height: bounds.height * ppu,
        primary: selection.zoneIds.at(-1) === id,
        resizable: isRectZone(zone),
        path: zoneOutlinePath(zone, bounds, ppu),
      }];
    });
  });

  function zoneOutlinePath(zone: Zone, bounds: ReturnType<typeof zoneBounds>, ppu: number): string {
    const cached = zoneOutlinePathCache.get(zone);
    if (cached?.parts === zone.parts && cached.holes === zone.holes && cached.ppu === ppu) return cached.value;
    const value = [...zone.parts, ...zone.holes].map((ring) =>
      `M ${ring.map((point) => `${(point.x - bounds.x) * ppu} ${(point.y - bounds.y) * ppu}`).join(" L ")} Z`,
    ).join(" ");
    zoneOutlinePathCache.set(zone, { parts: zone.parts, holes: zone.holes, ppu, value });
    return value;
  }

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

  $effect(() => {
    const activeTool = tool.active;
    const finishRequest = zoneMode.finishRequest;
    if (activeTool !== previousTool || finishRequest !== previousZoneFinishRequest) {
      previousTool = activeTool;
      previousZoneFinishRequest = finishRequest;
      finishZoneMoves();
    }

    const request = takeZoneMoveRequest();
    if (request) startZoneFollowMove(request.zoneId, request.startWorld);
  });

  onMount(() => {
    boardElement = layer.parentElement;
    if (!boardElement) return;

    const boardEl = boardElement;

    function onScaleModePointerDown(event: PointerEvent): void {
      const gesture = scaleModeGesture;
      if (!gesture) return;

      if (scaleModePointerAction(event.button) === "cancel") {
        suppressContextMenuUntil = performance.now() + 750;
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelScaleMode();
        return;
      }

      const local = localPoint(event);
      if (local) {
        event.preventDefault();
        event.stopImmediatePropagation();
        commitScaleMode(screenToWorld(camera, viewport, local), true);
      } else {
        commitScaleMode();
      }
    }

    function onAltNodePointerDown(event: PointerEvent): void {
      if (event.button !== 0 || event.isPrimary === false || activeGesture || grabGesture || zoneGrabGesture) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(".selection-context-pick, [data-create-menu]")) return;

      const noteId = target.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
      if (!shouldSelectNoteOnAltPress(
        noteId,
        event.altKey,
        event.ctrlKey,
        event.shiftKey,
        noteId ? isDimmed(noteId) : false,
      ) || !noteId || !boardState.notes[noteId]) return;

      const local = localPoint(event);
      if (!local) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      suppressBodyClickUntil = 0;
      suppressAltNodeClickUntil = Number.POSITIVE_INFINITY;
      pendingAltNodeActivationPointerId = event.pointerId;
      pendingAltContextPick = null;
      closeContextPick();
      selectNoteUndoable(noteId);
      const frames = framesForSelection();
      if (frames.length > 0) startMove(event, local, screenToWorld(camera, viewport, local), frames, noteId);
    }

    function onPointerDown(event: PointerEvent): void {
      if (event.button === 2 && activeGesture?.kind === "zone-move") {
        suppressContextMenuUntil = performance.now() + 750;
        zoneMode.suppressContextMenuUntil = suppressContextMenuUntil;
        event.preventDefault();
        event.stopPropagation();
        finishPointerGesture(activeGesture.pointerId, false);
        return;
      }
      if (event.button === 2 && zoneGrabGesture) {
        suppressContextMenuUntil = performance.now() + 750;
        zoneMode.suppressContextMenuUntil = suppressContextMenuUntil;
        event.preventDefault();
        event.stopPropagation();
        const local = localPoint(event);
        if (local) updateZoneGrabAt(screenToWorld(camera, viewport, local), event.ctrlKey);
        commitZoneGrab();
        return;
      }
      if (event.button === 2 && grabGesture) {
        suppressContextMenuUntil = performance.now() + 750;
        event.preventDefault();
        event.stopPropagation();
        cancelGrab();
        return;
      }

      if (event.button !== 0 || event.isPrimary === false) return;
      suppressBodyClickUntil = 0;
      suppressAltNodeClickUntil = 0;

      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(".selection-context-pick, [data-create-menu], [data-selection-ignore]")) return;

      const local = localPoint(event);
      if (!local) return;

      if (grabGesture) {
        event.preventDefault();
        event.stopPropagation();
        const world = screenToWorld(camera, viewport, local);
        updateGrabAt(world, event.ctrlKey, event.altKey);
        commitGrab(world, true);
        return;
      }

      if (zoneGrabGesture) {
        event.preventDefault();
        event.stopPropagation();
        updateZoneGrabAt(screenToWorld(camera, viewport, local), event.ctrlKey);
        commitZoneGrab();
        return;
      }

      const world = screenToWorld(camera, viewport, local);
      if (lineToolActive) return;

      if (tool.active === "zone") {
        if (zoneMode.active !== "move") return;
        const zoneId = hitTestZones(world, zones.byId, zones.order);
        if (!zoneId || !zones.byId[zoneId]) return;
        event.preventDefault();
        event.stopPropagation();
        startZoneMove(event, zoneId, local, world);
        capturePointer(event.pointerId);
        return;
      }
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
        if (id && edge && id === selection.primaryId && (event.shiftKey || hasResizeHandle(boardState.notes[id]?.type, edge, canResizeBottom(id)))) {
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
        if (activeGesture.kind === "marquee") updatePointerGesture(event, local);
        else {
          if (activeGesture.kind === "body-move") event.preventDefault();
          queueBoardMove({
            kind: "gesture",
            pointerId: event.pointerId,
            screen: local,
            event: {
              pointerId: event.pointerId,
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              preventDefault: () => {},
            },
          });
        }
        return;
      }

      if (zoneGrabGesture) {
        queueBoardMove({
          kind: "zone-grab",
          pointerId: event.pointerId,
          world: screenToWorld(camera, viewport, local),
          ctrl: event.ctrlKey,
          alt: event.altKey,
        });
        return;
      }

      if (scaleModeGesture && event.buttons === 0 && isPointInsideBoard(local)) {
        queueBoardMove({
          kind: "scale-mode",
          pointerId: event.pointerId,
          world: screenToWorld(camera, viewport, local),
          ctrl: event.ctrlKey,
          alt: event.altKey,
        });
        return;
      }

      // A middle-button pan remains owned by the camera while G move mode is active.
      if (grabGesture && event.buttons === 0 && isPointInsideBoard(local)) {
        queueBoardMove({
          kind: "grab",
          pointerId: event.pointerId,
          world: screenToWorld(camera, viewport, local),
          ctrl: event.ctrlKey,
          alt: event.altKey,
        });
      }
    }

    function onPointerUp(event: PointerEvent): void {
      const local = localPoint(event);
      if (pendingAltNodeActivationPointerId === event.pointerId) {
        pendingAltNodeActivationPointerId = null;
        suppressAltNodeClickUntil = performance.now() + 1000;
      }
      if (
        pendingAltContextPick?.pointerId === event.pointerId && local &&
        crossedGestureThreshold(pendingAltContextPick.startScreen, local)
      ) {
        pendingAltContextPick = null;
      }
      if (activeGesture?.pointerId !== event.pointerId) {
        flushBoardMove(event.pointerId);
        completePendingAltContextPick(event.pointerId, false);
        return;
      }
      cancelBoardMove(event.pointerId);
      if (local) updatePointerGesture(event, local, false);
      finishPointerGesture(event.pointerId, false);
    }

    function onPointerCancel(event: PointerEvent): void {
      if (pendingAltNodeActivationPointerId === event.pointerId) {
        pendingAltNodeActivationPointerId = null;
        suppressAltNodeClickUntil = 0;
      }
      cancelBoardMove(event.pointerId);
      if (activeGesture?.pointerId === event.pointerId) finishPointerGesture(event.pointerId, true);
      else completePendingAltContextPick(event.pointerId, true);
    }

    function onLostPointerCapture(event: PointerEvent): void {
      cancelBoardMove(event.pointerId);
      if (activeGesture?.pointerId === event.pointerId) finishPointerGesture(event.pointerId, true, false);
    }

    function onClick(event: MouseEvent): void {
      if (shouldSuppressAltNodeActivationClick(suppressAltNodeClickUntil, performance.now(), event.detail)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
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
        notifySelectionInteraction([id], "click");
        return;
      }

      if (event.ctrlKey) toggleNoteUndoable(id);
      else if (selection.ids.includes(id)) {
        changeSelectionUndoable(() => undefined, undefined, true);
        ensureEditingSelection(id);
        notifySelectionInteraction([id], "click");
      } else selectNoteUndoable(id);
    }

    function onDoubleClick(event: MouseEvent): void {
      if (shouldSuppressAltNodeActivationClick(suppressAltNodeClickUntil, performance.now(), event.detail)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const body = target.closest("[data-note-body]");
      const handle = target?.closest<HTMLElement>(
        '[data-resize-handle="bottom"], [data-resize-handle="top"], [data-resize-handle="left"], [data-resize-handle="right"]',
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
          preferences.fitWidthToText,
          isFixedSizeNodeKind(note.type),
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
        } else if (action === "auto-width") {
          event.preventDefault();
          event.stopPropagation();
          const before = frameForNote(id);
          const width = minimumTextWidthForNote(id, maximumWidthForKind(note.type)) + listStatisticsWidth(note);
          const fromLeft = handle.dataset.resizeHandle === "left";
          const after = {
            ...before,
            x: fromLeft ? before.x + before.width - width : before.x,
            width,
          };
          if (before.x !== after.x || before.width !== after.width) {
            execute(geometryCommand("Resize", note.name, [before], [after]));
          }
        }
        return;
      }

      const noteRoot = body?.closest<HTMLElement>("[data-note-id]");
      const editingId = noteRoot?.dataset.noteId;
      if (editingId && boardState.notes[editingId]) ensureEditingSelection(editingId);
    }

    function onContextMenu(event: MouseEvent): void {
      if (!grabGesture && !scaleModeGesture && !zoneGrabGesture && performance.now() > suppressContextMenuUntil) return;
      suppressContextMenuUntil = 0;
      event.preventDefault();
      event.stopPropagation();
      if (grabGesture) cancelGrab();
      else if (scaleModeGesture) cancelScaleMode();
      else if (zoneGrabGesture) commitZoneGrab();
    }

    function onNativeDragStart(event: DragEvent): void {
      if (activeGesture?.kind === "body-move" && activeGesture.started) {
        event.preventDefault();
        return;
      }
      if (activeGesture?.kind === "move" && pendingAltNodeActivationPointerId === activeGesture.pointerId) {
        event.preventDefault();
      }
    }

    function onPrecisionKeyDown(event: KeyboardEvent): void {
      shiftHeld = event.shiftKey;
      if (!isAltKey(event)) return;
      altHeld = true;
      if (activeGesture || grabGesture || scaleModeGesture || zoneGrabGesture) event.preventDefault();
      rebasePrecision(true);
    }

    function onPrecisionKeyUp(event: KeyboardEvent): void {
      shiftHeld = event.shiftKey;
      if (!isAltKey(event)) return;
      altHeld = event.altKey;
      rebasePrecision(altHeld);
    }

    function onTransformModeKeyDown(event: KeyboardEvent): void {
      if (grabGesture) {
        const isUndo = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.code === "KeyZ";
        if (isUndo || event.code === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelGrab();
          return;
        }

        if (event.code === "Enter") {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (pointer.world) commitGrab(pointer.world);
          return;
        }
        return;
      }

      if (scaleModeGesture) {
        const action = scaleModeKeyAction(event.code, event);
        if (action === "cancel") {
          event.preventDefault();
          event.stopImmediatePropagation();
          cancelScaleMode();
          return;
        }
        if (action === "ignore") return;

        const matchingCommand = findMatchingCommand(event, commands.values());
        if (matchingCommand?.id === "select.scale") {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.repeat) return;
          commitScaleMode();
          return;
        }
        commitScaleMode();
        return;
      }

      if (event.defaultPrevented || event.isComposing || isTextEditingTarget(event.target) || isTextEditingTarget(document.activeElement)) return;
      const command = findMatchingCommand(event, commands.values());
      if (command?.id !== "select.scale" || event.repeat || selection.ids.length === 0 || tool.active === "zone") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      command.run();
    }

    function onZoneMoveKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing || isTextEditingTarget(event.target)) return;
      if (event.code === "Enter" && (zoneGrabGesture || activeGesture?.kind === "zone-move")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (activeGesture?.kind === "zone-move") finishPointerGesture(activeGesture.pointerId, false);
        else commitZoneGrab();
      } else if (event.code === "Escape" && (zoneGrabGesture || activeGesture?.kind === "zone-move")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (activeGesture?.kind === "zone-move") finishPointerGesture(activeGesture.pointerId, true);
        else cancelZoneGrab();
      }
    }

    window.addEventListener("pointerdown", onScaleModePointerDown, true);
    window.addEventListener("pointerdown", onAltNodePointerDown, true);
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
    window.addEventListener("keydown", onTransformModeKeyDown, true);
    window.addEventListener("keydown", onZoneMoveKeyDown, true);

    const detachController = attachSelectionController({ escape, startGrab, startScale });

    function onWindowBlur(): void {
      pendingAltNodeActivationPointerId = null;
      suppressAltNodeClickUntil = 0;
      if (activeGesture) finishPointerGesture(activeGesture.pointerId, true);
      if (grabGesture) cancelGrab();
      if (scaleModeGesture) cancelScaleMode();
      if (zoneGrabGesture) cancelZoneGrab();
      altHeld = false;
      shiftHeld = false;
    }

    window.addEventListener("blur", onWindowBlur);

    return () => {
      if (activeGesture) finishPointerGesture(activeGesture.pointerId, true);
      if (grabGesture) cancelGrab();
      if (scaleModeGesture) cancelScaleMode();
      if (zoneGrabGesture) cancelZoneGrab();
      detachController();
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("keydown", onPrecisionKeyDown, true);
      window.removeEventListener("keyup", onPrecisionKeyUp, true);
      window.removeEventListener("keydown", onTransformModeKeyDown, true);
      window.removeEventListener("keydown", onZoneMoveKeyDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("pointerdown", onScaleModePointerDown, true);
      window.removeEventListener("pointerdown", onAltNodePointerDown, true);
      boardEl.removeEventListener("pointerdown", onPointerDown, true);
      boardEl.removeEventListener("dragstart", onNativeDragStart, true);
      boardEl.removeEventListener("lostpointercapture", onLostPointerCapture, true);
      boardEl.removeEventListener("click", onClick, true);
      boardEl.removeEventListener("dblclick", onDoubleClick, true);
      boardEl.removeEventListener("contextmenu", onContextMenu, true);
      boardElement = null;
    };
  });

  function queueBoardMove(move: PendingBoardMove): void {
    pendingBoardMove = move;
    if (pointerMoveFrame !== null) return;
    pointerMoveFrame = requestAnimationFrame(() => {
      pointerMoveFrame = null;
      const latest = pendingBoardMove;
      pendingBoardMove = null;
      if (latest) runBoardMove(latest);
    });
  }

  function flushBoardMove(pointerId?: number): void {
    const pending = pendingBoardMove;
    if (!pending || (pointerId !== undefined && pending.pointerId !== pointerId)) return;
    if (pointerMoveFrame !== null) cancelAnimationFrame(pointerMoveFrame);
    pointerMoveFrame = null;
    pendingBoardMove = null;
    runBoardMove(pending);
  }

  function cancelBoardMove(pointerId?: number): void {
    if (!pendingBoardMove || (pointerId !== undefined && pendingBoardMove.pointerId !== pointerId)) return;
    if (pointerMoveFrame !== null) cancelAnimationFrame(pointerMoveFrame);
    pointerMoveFrame = null;
    pendingBoardMove = null;
  }

  function runBoardMove(move: PendingBoardMove): void {
    if (move.kind === "gesture") {
      if (activeGesture?.pointerId === move.pointerId) updatePointerGesture(move.event, move.screen);
    } else if (move.kind === "zone-grab") {
      if (zoneGrabGesture) updateZoneGrabAt(move.world, move.ctrl, move.alt);
    } else if (move.kind === "scale-mode") {
      if (scaleModeGesture) updateScaleAt(move.world);
    } else if (grabGesture) {
      updateGrabAt(move.world, move.ctrl, move.alt);
    }
  }

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
    const scale = normalizeNoteScale(note.scale);
    const bounds = noteBounds(note);
    const maxHeight = note.type === "inbox"
      ? inboxAutoHeight(note) * scale
      : note.type === "glossary"
        ? measureDictionaryHeightLimits(id, userDictionary.words.length, bounds.height / scale).autoHeight * scale
        : note.type === "map" ? Number.POSITIVE_INFINITY : maximumResizableHeightForNote(id) * scale;
    const listLimits = listStatisticsFrameLimits(note,
      preferences.fitWidthToText ? minimumTextWidthForNote(id, maximumWidthForKind(note.type)) : MIN_NOTE_WIDTH,
      maximumWidthForKind(note.type));
    return {
      ...boundsAsFrame(id, bounds, note.height === null ? null : note.height * scale),
      type: note.type,
      ...(listLimits.minWidth === undefined ? {} : { minWidth: listLimits.minWidth * scale }),
      maxWidth: listLimits.maxWidth * scale,
      ...(listLimits.statisticsExtensionWidth === undefined ? {} : { statisticsExtensionWidth: listLimits.statisticsExtensionWidth * scale }),
      minHeight: minimumHeightForKind(note.type) * scale,
      maxHeight,
      scale,
      baseWidth: note.width,
      baseHeight: note.height,
      baseStatisticsExtensionWidth: listStatisticsWidth(note),
    };
  }

  function canShrinkBelowAutoHeight(id: string): boolean {
    const note = boardState.notes[id];
    if (!note) return false;
    if (note.type === "inbox") {
      const minimum = inboxMinHeight(note);
      const current = note.height ?? inboxAutoHeight(note);
      return current > minimum + 0.01 && inboxAutoHeight(note) > minimum + 0.01;
    }
    if (note.type === "glossary") {
      const scale = normalizeNoteScale(note.scale);
      const limits = measureDictionaryHeightLimits(id, userDictionary.words.length, noteBounds(note).height / scale);
      return limits.canShrink && (note.height ?? limits.autoHeight) > limits.minimumHeight + 0.01;
    }
    return false;
  }

  function canResizeBottom(id: string): boolean {
    const note = boardState.notes[id];
    if (note?.type === "list") return (note.listItems?.length ?? 0) > 7;
    return canShrinkBelowAutoHeight(id);
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
  ): void {
    const zone = zones.byId[id];
    if (!zone) return;
    const members = memberPositions(id);
    beginZoneMoveBatch();
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

  function memberPositions(id: string): MemberPosition[] {
    return zoneMembers(id).flatMap((memberId) => {
      const note = boardState.notes[memberId];
      return note ? [{ id: memberId, x: note.x, y: note.y }] : [];
    });
  }

  function startZoneFollowMove(id: string, startWorld: Point): void {
    const zone = zones.byId[id];
    if (!zone || activeGesture || grabGesture || zoneGrabGesture) return;
    const members = memberPositions(id);
    zoneGrabGesture = createZoneMoveGesture(
      zone,
      Object.values(zones.byId).filter((other) => other.id !== id),
      members,
      startWorld,
    );
    beginZoneMoveBatch();
    zoneMode.followMoveActive = true;
    zoneGrabStartWorld = { ...startWorld };
    zoneGrabPrecision = createPrecisionDeltaTracker(startWorld, altHeld);
    zoneCollisionHint = false;
  }

  function updateZoneGrabAt(world: Point, carryMembers: boolean, alt = altHeld): void {
    if (!zoneGrabGesture) return;
    const precision = zoneGrabPrecision ? updatePrecisionDelta(zoneGrabPrecision, world, alt) : null;
    if (precision) zoneGrabPrecision = precision.tracker;
    const adjustedWorld = zoneGrabStartWorld && precision ? addPoint(zoneGrabStartWorld, precision.delta) : world;
    zoneGrabGesture = updateZoneMoveGesture(
      zoneGrabGesture,
      adjustedWorld,
      grid.snap || carryMembers,
      grid.step,
      carryMembers,
    );
    applyZoneMovePreview(zoneGrabGesture);
    zoneCollisionHint = zoneGrabGesture.blocked;
  }

  function commitZoneGrab(): void {
    flushBoardMove();
    const gesture = zoneGrabGesture;
    if (!gesture) return;
    zoneGrabGesture = null;
    zoneMode.followMoveActive = false;
    zoneGrabStartWorld = null;
    zoneGrabPrecision = null;
    zoneCollisionHint = false;
    if (zoneGestureChanged(gesture.beforeZone, gesture.afterZone)) {
      applyZoneMove(gesture.afterZone, gesture.afterMembers);
      recordZoneMove(gesture);
    }
    endZoneMoveBatch();
  }

  function cancelZoneGrab(): void {
    cancelBoardMove();
    const gesture = zoneGrabGesture;
    if (!gesture) return;
    zoneGrabGesture = null;
    zoneMode.followMoveActive = false;
    zoneGrabStartWorld = null;
    zoneGrabPrecision = null;
    zoneCollisionHint = false;
    const cancelled = cancelZoneMoveGesture(gesture);
    applyMemberPositions(cancelled.beforeMembers);
    endZoneMoveBatch();
  }

  function recordZoneMove(gesture: ZoneMoveGesture): void {
    const command = zoneMoveHistoryCommand(gesture, applyZoneMove);
    if (command) record(command);
  }

  function finishZoneMoves(): void {
    if (activeGesture?.kind === "zone-move") finishPointerGesture(activeGesture.pointerId, false);
    if (zoneGrabGesture) commitZoneGrab();
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
    beginZoneMoveBatch();
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

  function updatePointerGesture(event: GesturePointerInput, screen: Point, captureForFollowup = true): void {
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
    if (justStarted && gesture.kind === "move") beginMovingStacking(gesture.gesture.before);

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
          selectNoteUndoable(gesture.noteId, "move");
        }
        const frames = framesForSelection();
        if (frames.length === 0) return;
        gesture.gesture = createMoveGesture(frames, gesture.noteId, gesture.startWorld);
        beginMovingStacking(frames);
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
      previewDropTarget(gesture.gesture.before.map((frame) => frame.id), world);
      return;
    }

    const adjustedWorld = addPoint(gesture.gesture.startWorld, precision.delta);

    if (gesture.kind === "zone-move") {
      gesture.gesture = updateZoneMoveGesture(
        gesture.gesture, adjustedWorld, grid.snap || event.ctrlKey, grid.step, event.ctrlKey,
      );
      applyZoneMovePreview(gesture.gesture);
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
      previewDropTarget(gesture.gesture.before.map((frame) => frame.id), world);
      return;
    }

    if (gesture.kind === "resize") {
      gesture.gesture = updateResizeGesture(
        gesture.gesture,
        adjustedWorld,
        grid.snap || event.ctrlKey,
        grid.step,
        event.shiftKey,
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
    if (cancelled) cancelBoardMove(pointerId);
    else flushBoardMove(pointerId);
    const gesture = activeGesture;
    if (!gesture || gesture.pointerId !== pointerId) return;
    activeGesture = null;
    if (gesture.kind === "move" || gesture.kind === "body-move") endMovingStacking();
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
        notifySelectionInteraction(ids, "marquee");
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
        const after = normalizeScaleResizeAtCommit(gesture.gesture);
        if (gesture.gesture.after.scaleGesture) applyFrames([after]);
        const change = resizeGestureChange({ ...gesture.gesture, after });
        if (change) {
          const note = boardState.notes[change.before[0].id];
          const scaleChanged = normalizeNoteScale(change.before[0].scale) !== normalizeNoteScale(change.after[0].scale);
          recordGeometryChange(scaleChanged ? "Scale" : "Resize", note?.name ?? "", change);
        }
      }
    } else if (gesture.kind === "zone-move") {
      if (cancelled) {
        const before = cancelZoneMoveGesture(gesture.gesture);
        applyMemberPositions(before.beforeMembers);
      } else if (gesture.started && zoneGestureChanged(gesture.gesture.beforeZone, gesture.gesture.afterZone)) {
        applyZoneMove(gesture.gesture.afterZone, gesture.gesture.afterMembers);
        recordZoneMove(gesture.gesture);
      }
      endZoneMoveBatch();
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
      endZoneMoveBatch();
    } else if (cancelled) {
      applyFrames(cancelGroupScaleGesture(gesture.gesture));
    } else if (gesture.started) {
      const change = groupScaleGestureChange(gesture.gesture);
      if (change) recordGeometryChange("Scale", `${change.before.length} notes`, change);
    }

    clearModuleDropPreview();
    clearDropTargetPreview();
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
    previewDropTarget(grabGesture.before.map((frame) => frame.id), world);
  }

  function startGrab(): void {
    if (tool.active === "zone") {
      const point = pointer.world;
      const id = point ? hitTestZones(point, zones.byId, zones.order) : null;
      if (point && id) startZoneFollowMove(id, point);
      return;
    }
    if (grabGesture || scaleModeGesture || activeGesture || selection.ids.length === 0) return;
    const frames = framesForSelection();
    if (frames.length === 0) return;
    const anchorId = selection.primaryId && boardState.notes[selection.primaryId]
      ? selection.primaryId
      : frames[0].id;
    grabGesture = createMoveGesture(frames, anchorId, pointer.world ?? { x: frames[0].x, y: frames[0].y });
    beginMovingStacking(frames);
    grabStartWorld = pointer.world ? { ...pointer.world } : null;
    grabPrecision = pointer.world ? createPrecisionDeltaTracker(pointer.world, altHeld) : null;
    selection.grabActive = true;
    transformModeHint = "Move";
  }

  function commitGrab(world: Point, suppressClick = false): void {
    flushBoardMove();
    if (!grabGesture) return;
    commitMoveGesture(grabGesture, world);
    if (suppressClick) suppressBodyClickUntil = performance.now() + 500;
    endMovingStacking();
    clearModuleDropPreview();
    clearDropTargetPreview();
    grabGesture = null;
    grabStartWorld = null;
    grabPrecision = null;
    selection.grabActive = false;
    transformModeHint = null;
  }

  function cancelGrab(): void {
    cancelBoardMove();
    if (!grabGesture) return;
    applyFrames(cancelMoveGesture(grabGesture));
    endMovingStacking();
    clearModuleDropPreview();
    grabGesture = null;
    grabStartWorld = null;
    grabPrecision = null;
    selection.grabActive = false;
    transformModeHint = null;
  }

  function startScale(): void {
    if (tool.active === "zone" || scaleModeGesture || grabGesture || activeGesture || selection.ids.length === 0) return;
    const frames = framesForSelection();
    if (frames.length === 0) return;
    const bounds = unionBounds(frames.flatMap((frame) => {
      const note = boardState.notes[frame.id];
      return note ? [noteBounds(note)] : [];
    }));
    if (!bounds) return;
    const pivot = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const startWorld = pointer.world ?? pivot;
    scaleModeGesture = createScaleModeGesture(frames, pivot, startWorld, 1 / pixelsPerUnit(camera));
    beginMovingStacking(frames);
    transformModeHint = "Scale";
  }

  function updateScaleAt(world: Point): void {
    if (!scaleModeGesture) return;
    scaleModeGesture = updateScaleModeGesture(scaleModeGesture, world);
    applyFrames(scaleModeGesture.after);
  }

  function commitScaleMode(world?: Point, suppressClick = false): void {
    flushBoardMove();
    if (!scaleModeGesture) return;
    if (world) updateScaleAt(world);
    const gesture = scaleModeGesture;
    const after = normalizeScaleModeAtCommit(gesture);
    applyFrames(after);
    const change = scaleModeGestureChange({ ...gesture, after });
    if (change) recordGeometryChange("Scale", `${change.before.length} notes`, change);
    if (suppressClick) suppressBodyClickUntil = performance.now() + 500;
    endMovingStacking();
    clearModuleDropPreview();
    clearDropTargetPreview();
    scaleModeGesture = null;
    transformModeHint = null;
  }

  function cancelScaleMode(): void {
    cancelBoardMove();
    if (!scaleModeGesture) return;
    applyFrames(cancelScaleModeGesture(scaleModeGesture));
    endMovingStacking();
    clearModuleDropPreview();
    clearDropTargetPreview();
    scaleModeGesture = null;
    transformModeHint = null;
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
    if (scaleModeGesture) {
      cancelScaleMode();
      return;
    }
    if (zoneGrabGesture) {
      cancelZoneGrab();
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

  function selectNoteUndoable(noteId: string, source: "click" | "move" = "click"): void {
    changeSelectionUndoable((next) => {
      next.ids = [noteId];
      next.zoneIds = [];
      next.primaryId = noteId;
    }, undefined, true);
    notifySelectionInteraction([noteId], source);
  }

  function toggleNoteUndoable(noteId: string): void {
    const wasSelected = selection.ids.includes(noteId);
    changeSelectionUndoable((next) => {
      if (next.ids.includes(noteId)) {
        next.ids = next.ids.filter((id) => id !== noteId);
        if (next.primaryId === noteId) next.primaryId = next.ids.at(-1) ?? null;
      } else {
        next.ids = [...next.ids, noteId];
        next.primaryId = noteId;
      }
    }, undefined, true);
    if (!wasSelected && selection.ids.includes(noteId)) notifySelectionInteraction([noteId], "click");
  }

  function setPrimaryUndoable(noteId: string): void {
    changeSelectionUndoable((next) => {
      if (next.ids.includes(noteId)) next.primaryId = noteId;
    }, undefined, true);
    notifySelectionInteraction([noteId], "click");
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
    if (zoneGrabPrecision) zoneGrabPrecision = setPrecisionAlt(zoneGrabPrecision, alt);
  }

  function isAltKey(event: KeyboardEvent): boolean {
    return event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight";
  }

  function addPoint(point: Point, delta: Point): Point {
    return { x: point.x + delta.x, y: point.y + delta.y };
  }

  function applyFrames(frames: readonly NoteFrame[]): void {
    for (const frame of frames) {
      const note = boardState.notes[frame.id];
      if (!note) continue;
      const frameScale = Object.prototype.hasOwnProperty.call(frame, "scale") ? frame.scale : note.scale;
      const scale = normalizeNoteScale(frameScale);
      const baseStatisticsWidth = frame.baseStatisticsExtensionWidth ?? listStatisticsWidth(note);
      const preservedBaseWidth = frame.baseWidth ?? note.width;
      const expectedVisualWidth = (preservedBaseWidth + baseStatisticsWidth) * scale;
      const baseWidth = nearlyEqual(frame.width, expectedVisualWidth)
        ? preservedBaseWidth
        : (frame.width - (frame.statisticsExtensionWidth ?? baseStatisticsWidth * scale)) / scale;
      const baseHeight = frame.height === null
        ? frame.baseHeight === undefined ? null : frame.baseHeight
        : frame.baseHeight !== undefined && frame.baseHeight !== null && nearlyEqual(frame.height, frame.baseHeight * scale)
          ? frame.baseHeight
          : frame.height / scale;
      const baseFrame = {
        ...frame,
        width: baseWidth + baseStatisticsWidth,
        height: baseHeight,
        statisticsExtensionWidth: baseStatisticsWidth,
      };
      updateNote(frame.id, {
        ...geometryFromListStatisticsFrame(note, baseFrame),
        scale: scale > 1 ? scale : undefined,
      });
    }
  }

  function nearlyEqual(first: number, second: number): boolean {
    return Math.abs(first - second) <= Math.max(1, Math.abs(first), Math.abs(second)) * 1e-9;
  }

  function applyZoneGeometry(zone: Zone): void {
    updateZone(zone.id, {
      parts: zone.parts.map((part) => part.map((point) => ({ ...point }))),
      holes: zone.holes.map((hole) => hole.map((point) => ({ ...point }))),
    });
  }

  function applyZoneMove(zone: Zone, members: readonly MemberPosition[]): void {
    applyZoneGeometry(zone);
    applyMemberPositions(members);
  }

  function beginMovingStacking(frames: readonly NoteFrame[]): void {
    endMovingStacking();
    if (!boardElement) return;
    const ids = new Set(frames.map((frame) => frame.id));
    const cards = [...boardElement.querySelectorAll<HTMLElement>(".note-card[data-note-id], .beacon-object[data-note-id]")]
      .filter((card) => ids.has(card.dataset.noteId ?? ""));
    restoreMovingStacking = raiseMovingCards(cards);
  }

  function endMovingStacking(): void {
    restoreMovingStacking?.();
    restoreMovingStacking = null;
  }

  function applyZoneMovePreview(gesture: ZoneMoveGesture): void {
    setZoneMovePreview(gesture.beforeZone.id, gesture.offset);
    applyMemberPositions(gesture.afterMembers);
  }

  function applyMemberPositions(members: readonly MemberPosition[]): void {
    for (const member of members) {
      const note = boardState.notes[member.id];
      if (note && (note.x !== member.x || note.y !== member.y)) {
        updateNote(member.id, { x: member.x, y: member.y });
      }
    }
  }

  function beginZoneMoveBatch(): void {
    if (zoneMembershipBatchOpen) return;
    beginZoneMembershipBatch();
    zoneMembershipBatchOpen = true;
  }

  function endZoneMoveBatch(): void {
    clearZoneMovePreview();
    if (!zoneMembershipBatchOpen) return;
    zoneMembershipBatchOpen = false;
    endZoneMembershipBatch();
  }

  function commitMoveGesture(gesture: MoveGesture, worldPoint: Point): void {
    const dropCommand = dropOnTarget(gesture.before.map((frame) => frame.id), worldPoint);
    if (dropCommand) {
      applyFrames(gesture.before);
      execute(dropCommand);
      notifySelectionInteraction([gesture.anchorId, ...gesture.before.map((frame) => frame.id)], "move");
      return;
    }

    const movedTypes = gesture.before.map((frame) => boardState.notes[frame.id]?.type ?? "note");
    const initialDecision = resolveModuleDropDecision(movedTypes, false);
    const moduleId = initialDecision.tryInsert && gesture.before.length === 1
      ? gesture.before[0].id
      : null;
    let inserted = false;
    if (moduleId) {
      // Insert from the module's pre-drag position so Undo brings it back where it was dragged from.
      const dropped = boardState.notes[moduleId];
      const droppedFrame = dropped ? frameForNote(moduleId) : null;
      applyFrames(gesture.before);
      inserted = tryInsertModuleOnDrop(moduleId, worldPoint);
      if (!inserted && droppedFrame) applyFrames([droppedFrame]);
    }
    const decision = resolveModuleDropDecision(movedTypes, false, inserted);
    if (!decision.commitMove) return;

    const change = moveGestureChange(gesture);
    if (change) {
      recordGeometryChange("Move", targetForMove(change.before, gesture.anchorId), change);
      notifySelectionInteraction([gesture.anchorId, ...gesture.before.map((frame) => frame.id)], "move");
    }
  }

  function updateModulePreview(frames: readonly NoteFrame[], worldPoint: Point): void {
    if (frames.length !== 1) return;
    const note = boardState.notes[frames[0].id];
    if (note?.type === "importance" || note?.type === "purpose" || note?.type === "mood" || note?.type === "markas" || note?.type === "stats") {
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
    return geometryHistoryCommand(label, target, before, after, applyFrames);
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

  function resizeHandleTitle(edge: ResizeEdge, standaloneModule = false, scaleOnly = false): string {
    if (scaleOnly) return `Scale from ${handleLabel(edge)}; hold Shift while dragging`;
    if (standaloneModule) {
      return `Resize height from ${edge.startsWith("top") ? "top" : "bottom"}; hold Shift to scale uniformly`;
    }
    const base = `Resize from ${handleLabel(edge)}`;
    const detail = edge === "top" || edge === "bottom" ? "; double-click for auto height" : "";
    return `${base}${detail}; hold Shift to scale uniformly`;
  }

  function groupHandleTitle(edge: ResizeEdge): string {
    const base = `Scale selection from ${handleLabel(edge)}`;
    return isCornerHandle(edge) ? `${base}; hold Shift to preserve aspect ratio` : base;
  }
</script>

<div
  class="selection-layer"
  class:line-tool-active={lineToolActive}
  data-transform-mode={transformModeHint?.toLowerCase()}
  data-shift-held={shiftHeld ? "true" : undefined}
  bind:this={layer}
  aria-hidden="false"
>
  {#each zoneOutlines as outline (outline.id)}
    <div
      class="selection-outline selection-zone-outline"
      class:complex={!outline.resizable}
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
      {#if !outline.resizable}
        <svg class="selection-zone-shape" width={outline.width} height={outline.height} aria-hidden="true">
          <path d={outline.path} stroke={outline.color} stroke-width={outline.primary ? 1.5 : 1} fill="none" />
        </svg>
      {/if}
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
        {@const canShrink = canResizeBottom(outline.id)}
        {#each RESIZE_EDGES as edge (edge)}
          {@const normalResize = hasResizeHandle(outline.kind, edge, canShrink)}
          {#if shouldShowResizeHandle(outline.kind, edge, canShrink, shiftHeld)}
            <button
              class={`resize-handle resize-handle-${edge}`}
              class:resize-handle-corner={isCornerHandle(edge)}
              class:resize-handle-side={!isCornerHandle(edge)}
              class:module-vertical-handle={isStandaloneModuleKind(outline.kind) && isCornerHandle(edge)}
              class:scale-only-handle={!normalResize}
              type="button"
              data-resize-handle={edge}
              data-shift-scale-handle={shiftHeld ? edge : undefined}
              data-note-id={outline.id}
              aria-disabled={lineToolActive ? "true" : undefined}
              tabindex={lineToolActive ? -1 : undefined}
              aria-label={`${shiftHeld || !normalResize
                ? `Scale ${outline.name} from ${handleLabel(edge)}`
                : isStandaloneModuleKind(outline.kind)
                  ? `Resize ${outline.name} height from ${edge.startsWith("top") ? "top" : "bottom"}`
                  : `Resize ${outline.name} from ${handleLabel(edge)}`}; hold Shift to scale uniformly`}
              title={resizeHandleTitle(edge, isStandaloneModuleKind(outline.kind), !normalResize)}
            ></button>
          {/if}
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

  {#if transformModeHint === "Move"}
    <div class="transform-mode-hint" data-transform-mode-hint="move" role="status">
      Move selection · click to confirm · right-click, Esc, or Ctrl+Z to cancel
    </div>
  {:else if transformModeHint === "Scale"}
    <div class="transform-mode-hint" data-transform-mode-hint="scale" role="status">
      Scale selection · click or Enter to confirm · right-click, Esc, or Ctrl+Z to cancel · any key exits
    </div>
  {/if}

  {#if selection.contextPick}
    <div
      class="selection-context-pick"
      role="listbox"
      aria-label="Choose overlapping note"
      style={boardPopupStyle(camera, viewport, { x: selection.contextPick.x, y: selection.contextPick.y }, selection.contextPick.zoomAtOpen)}
      use:dismissBoardPopup={{ close: closeContextPick, escape: false }}
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

  .selection-zone-outline.complex { outline: none; box-shadow: none; }
  .selection-zone-shape { overflow: visible; pointer-events: none; }

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
    /* A handle focused by the mouse would show the webview's round focus ring after the next key press (e.g. C). */
    outline: none;
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

  .transform-mode-hint {
    position: absolute;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 24px);
    padding: 4px 8px;
    border: 1px solid #4a4a4a;
    border-radius: 3px;
    background: rgba(28, 28, 28, 0.94);
    color: var(--text);
    font-size: 11px;
    text-align: center;
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
