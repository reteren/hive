<script lang="ts">
  import { onMount, tick } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { worldToScreen, type Point } from "../board/cameraMath";
  import { board } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import { emptyGraphData, type GraphPoint } from "../model/nodeData";
  import { teleportToObject } from "../navigation/navigate";
  import { searchNotes } from "../search/matching";
  import { activeDropTarget, registerDropTarget, type DropTargetMatch } from "../selection/dropTargets";
  import { dismissBoardPopup } from "../ui/boardAnchor";
  import { listPickerInput } from "../list/pickerInput";
  import { addGraphPoint, fractionInRect, graphPointAt, graphPointDisplay, updateGraphPoint } from "./logic";
  import {
    addPoint,
    deleteGraphPoint,
    graphChangeCommand,
    graphFor,
    linkGraphPoint,
    moveGraphPoint,
    renameGraphAxis,
    renameGraphPoint,
  } from "./actions.svelte";
  import { newId } from "../model/note";
  import { t } from "../i18n/i18n.svelte";

  let { note }: { note: Note } = $props();
  let plot: HTMLDivElement | undefined = $state();
  let graph = $derived(note.graph ?? emptyGraphData());
  /** Live position of the point being dragged; committed as one Undo step on release. */
  let dragging = $state<{ pointId: string; pointerId: number; start: Point; x: number; y: number; moved: boolean } | null>(null);
  let editingId = $state<string | null>(null);
  let labelDraft = $state("");
  let labelInput: HTMLInputElement | undefined = $state();
  let menu = $state<{ pointId: string; linking: boolean } | null>(null);
  let query = $state("");
  let searchInput: HTMLInputElement | undefined = $state();
  let selectedId = $state<string | null>(null);
  let dropPayload = $derived($activeDropTarget?.ownerId === `graph:${note.id}`
    ? ($activeDropTarget.payload as { pointId?: string; x?: number; y?: number } | undefined) ?? null : null);

  let choices = $derived.by(() => {
    const candidates = board.order.flatMap((id) => {
      const item = board.notes[id];
      return item && id !== note.id ? [{ id, name: item.name, text: item.text }] : [];
    });
    if (!query.trim()) return candidates.slice(0, 20);
    return searchNotes(query, candidates).filter((result) => result.kind === "name").slice(0, 20)
      .flatMap((result) => candidates.find((item) => item.id === result.noteId) ?? []);
  });

  onMount(() => registerDropTarget({
    ownerId: `graph:${note.id}`,
    accepts: findDropTarget,
    drop: (ids, match) => {
      const payload = match.payload as { pointId?: string; x: number; y: number };
      const current = graphFor(note.id);
      const next = payload.pointId
        ? updateGraphPoint(current, payload.pointId, { targetId: ids[0] })
        : addGraphPoint(current, { id: newId(), x: payload.x, y: payload.y, label: "", targetId: ids[0] });
      return graphChangeCommand(note.id, t("Link node to Graph point"), next);
    },
  }));

  function findDropTarget(ids: readonly string[], world: Point): DropTargetMatch | null {
    if (ids.length !== 1 || ids[0] === note.id || !board.notes[ids[0]] || !plot) return null;
    const boardRect = plot.closest<HTMLElement>(".board")?.getBoundingClientRect();
    if (!boardRect) return null;
    const screen = worldToScreen(camera, viewport, world);
    const clientX = boardRect.left + screen.x;
    const clientY = boardRect.top + screen.y;
    const rect = plot.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const hit = graphPointAt(graph, clientX, clientY, rect);
    const at = fractionInRect(clientX, clientY, rect);
    return { ownerId: `graph:${note.id}`, targetId: note.id, payload: hit ? { pointId: hit.id, x: hit.x, y: hit.y } : at };
  }

  function position(point: GraphPoint): { x: number; y: number } {
    return dragging?.pointId === point.id ? { x: dragging.x, y: dragging.y } : point;
  }

  async function beginLabelEdit(pointId: string): Promise<void> {
    menu = null;
    editingId = pointId;
    labelDraft = graph.points.find((point) => point.id === pointId)?.label ?? "";
    await tick();
    labelInput?.focus();
    labelInput?.select();
  }

  function finishLabelEdit(commit: boolean): void {
    if (!editingId) return;
    const id = editingId;
    editingId = null;
    if (commit) renameGraphPoint(note.id, id, labelDraft);
  }

  function addPointAt(event: MouseEvent): void {
    if (!plot || event.target !== plot) return;
    event.preventDefault();
    event.stopPropagation();
    const at = fractionInRect(event.clientX, event.clientY, plot.getBoundingClientRect());
    const id = addPoint(note.id, at.x, at.y);
    if (id) void beginLabelEdit(id);
  }

  function beginPointDrag(point: GraphPoint, event: PointerEvent): void {
    if (event.button !== 0 || editingId === point.id) return;
    event.preventDefault();
    event.stopPropagation();
    selectedId = point.id;
    (event.currentTarget as HTMLElement).focus();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging = { pointId: point.id, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, x: point.x, y: point.y, moved: false };
  }

  function movePointDrag(event: PointerEvent): void {
    if (!dragging || dragging.pointerId !== event.pointerId || !plot) return;
    event.stopPropagation();
    if (!dragging.moved && Math.hypot(event.clientX - dragging.start.x, event.clientY - dragging.start.y) < 4) return;
    const at = fractionInRect(event.clientX, event.clientY, plot.getBoundingClientRect());
    dragging = { ...dragging, x: at.x, y: at.y, moved: true };
  }

  function endPointDrag(event: PointerEvent, cancelled = false): void {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const finished = dragging;
    dragging = null;
    if (cancelled) return;
    if (finished.moved) {
      moveGraphPoint(note.id, finished.pointId, finished.x, finished.y);
      return;
    }
    // A plain click on a linked point jumps to its node.
    const point = graph.points.find((item) => item.id === finished.pointId);
    if (point?.targetId && board.notes[point.targetId]) teleportToObject(point.targetId, { label: t("Open Graph point") });
  }

  function handlePointKeydown(point: GraphPoint, event: KeyboardEvent): void {
    if (editingId) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      deleteGraphPoint(note.id, point.id);
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      event.stopPropagation();
      void beginLabelEdit(point.id);
    }
  }

  function openMenu(point: GraphPoint, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    selectedId = point.id;
    menu = { pointId: point.id, linking: false };
  }

  async function startLinking(): Promise<void> {
    if (!menu) return;
    menu = { ...menu, linking: true };
    query = "";
    await tick();
    searchInput?.focus();
  }

  function closeMenu(): void {
    menu = null;
    query = "";
  }

  function chooseTarget(targetId: string | null): void {
    if (menu) linkGraphPoint(note.id, menu.pointId, targetId);
    closeMenu();
  }

  function commitAxis(axis: "x" | "y", event: Event): void {
    renameGraphAxis(note.id, axis, (event.currentTarget as HTMLInputElement).value);
  }

  function axisKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Enter" || event.key === "Escape") (event.currentTarget as HTMLInputElement).blur();
  }
</script>

<div class="graph-node" data-graph-node={note.id}>
  <input
    class="graph-axis graph-axis-y"
    data-selection-ignore
    value={graph.yLabel}
    placeholder={t("Y axis")}
    aria-label={t("Vertical axis name")}
    onchange={(event) => commitAxis("y", event)}
    onkeydown={axisKeydown}
  />
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="graph-plot"
    class:drop-target={dropPayload !== null && !dropPayload.pointId}
    bind:this={plot}
    data-selection-ignore
    data-graph-plot={note.id}
    role="group"
    aria-label={t("Graph plot. Double-click to add a point.")}
    ondblclick={addPointAt}
  >
    {#each graph.points as point (point.id)}
      {@const at = position(point)}
      {@const display = graphPointDisplay(point, board.notes)}
      <div
        class="graph-point"
        class:linked={point.targetId !== null && !display.missing}
        class:missing={display.missing}
        class:selected={selectedId === point.id}
        class:drop-target={dropPayload?.pointId === point.id}
        class:right-label={at.x > 0.75}
        style:left={`${at.x * 100}%`}
        style:bottom={`${at.y * 100}%`}
        data-graph-point={point.id}
        data-own-context-menu
        role="button"
        tabindex="0"
        aria-label={display.text || t("Graph point")}
        title={point.targetId && !display.missing ? t("Click to open the linked node") : undefined}
        onpointerdown={(event) => beginPointDrag(point, event)}
        onpointermove={movePointDrag}
        onpointerup={(event) => endPointDrag(event)}
        onpointercancel={(event) => endPointDrag(event, true)}
        ondblclick={(event) => { event.stopPropagation(); void beginLabelEdit(point.id); }}
        oncontextmenu={(event) => openMenu(point, event)}
        onkeydown={(event) => handlePointKeydown(point, event)}
        onblur={() => { if (selectedId === point.id && !menu) selectedId = null; }}
      >
        <span class="graph-dot"></span>
        {#if editingId === point.id}
          <input
            class="graph-label-edit"
            bind:this={labelInput}
            bind:value={labelDraft}
            placeholder={display.text || t("Label")}
            aria-label={t("Point label")}
            onpointerdown={(event) => event.stopPropagation()}
            onkeydown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") { event.preventDefault(); finishLabelEdit(true); }
              else if (event.key === "Escape") { event.preventDefault(); finishLabelEdit(false); }
            }}
            onblur={() => finishLabelEdit(true)}
          />
        {:else if display.text || display.missing}
          <span class="graph-label">{display.missing && !point.label.trim() ? t("Missing node") : display.text}</span>
        {/if}
        {#if menu?.pointId === point.id}
          <div
            class="graph-menu"
            data-selection-ignore
            role="menu"
            tabindex="-1"
            use:dismissBoardPopup={{ close: closeMenu }}
            onpointerdown={(event) => event.stopPropagation()}
            ondblclick={(event) => event.stopPropagation()}
          >
            {#if menu.linking}
              <div class="graph-picker" use:listPickerInput={closeMenu}>
                <input
                  bind:this={searchInput}
                  bind:value={query}
                  placeholder={t("Find a node…")}
                  aria-label={t("Find a node to link")}
                  onkeydown={(event) => event.stopPropagation()}
                />
                <div class="graph-picker-results">
                  {#each choices as choice (choice.id)}
                    <button type="button" data-graph-target-option={choice.id} onclick={() => chooseTarget(choice.id)}>{choice.name}</button>
                  {:else}
                    <span class="graph-picker-empty">{t("No matching board object.")}</span>
                  {/each}
                </div>
              </div>
            {:else}
              <button type="button" role="menuitem" onclick={() => void beginLabelEdit(point.id)}>{t("Rename")}</button>
              <button type="button" role="menuitem" onclick={() => void startLinking()}>{point.targetId ? t("Link another node…") : t("Link a node…")}</button>
              {#if point.targetId}
                <button type="button" role="menuitem" onclick={() => chooseTarget(null)}>{t("Unlink node")}</button>
              {/if}
              <button type="button" role="menuitem" class="danger" onclick={() => { closeMenu(); deleteGraphPoint(note.id, point.id); }}>{t("Delete point")}</button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
    {#if graph.points.length === 0}
      <span class="graph-hint">{t("Double-click to add a point, or drop a node here")}</span>
    {/if}
  </div>
  <input
    class="graph-axis graph-axis-x"
    data-selection-ignore
    value={graph.xLabel}
    placeholder={t("X axis")}
    aria-label={t("Horizontal axis name")}
    onchange={(event) => commitAxis("x", event)}
    onkeydown={axisKeydown}
  />
</div>

<style>
  :global(.note-card[data-kind="graph"] .note-content) { display: flex; min-height: 0; padding: 4px 6px 6px; overflow: hidden; }

  .graph-node {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    gap: 3px;
  }

  .graph-axis {
    box-sizing: border-box;
    min-width: 0;
    max-width: 60%;
    padding: 1px 3px;
    border: 1px solid transparent;
    border-radius: 3px;
    outline: none;
    background: transparent;
    color: var(--text-dim);
    font: 10px/1.3 inherit;
    font-family: inherit;
  }

  .graph-axis:hover, .graph-axis:focus { border-color: var(--border); background: var(--bg-panel-raised); color: var(--text); }
  .graph-axis::placeholder { color: color-mix(in srgb, var(--text-dim) 60%, transparent); }
  .graph-axis-x { justify-self: end; text-align: right; }

  .graph-plot {
    position: relative;
    min-height: 0;
    margin: 0 8px 0 4px;
    border-left: 2px solid var(--text-dim);
    border-bottom: 2px solid var(--text-dim);
    background-image:
      linear-gradient(to right, color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1px),
      linear-gradient(to top, color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1px);
    background-size: 10% 10%;
    background-position: left bottom;
    cursor: crosshair;
  }

  /* Axis arrow heads. */
  .graph-plot::before, .graph-plot::after { content: ""; position: absolute; border: 4px solid transparent; pointer-events: none; }
  .graph-plot::before { top: -6px; left: -5px; border-bottom: 6px solid var(--text-dim); border-top-width: 0; }
  .graph-plot::after { right: -6px; bottom: -5px; border-left: 6px solid var(--text-dim); border-right-width: 0; }

  .graph-plot.drop-target { background-color: color-mix(in srgb, var(--accent) 10%, transparent); }

  .graph-point {
    position: absolute;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    transform: translate(-5px, 5px);
    outline: none;
    cursor: grab;
    white-space: nowrap;
  }

  .graph-point.right-label { flex-direction: row-reverse; transform: translate(calc(-100% + 5px), 5px); }
  .graph-point:active { cursor: grabbing; }
  .graph-point.selected, .graph-point:focus-visible { z-index: 3; }

  .graph-dot {
    flex: none;
    box-sizing: border-box;
    width: 10px;
    height: 10px;
    border: 2px solid var(--accent);
    border-radius: 50%;
    background: var(--bg-panel);
    transition: transform 120ms ease;
  }

  .graph-point.linked .graph-dot { background: var(--accent); }
  .graph-point.linked { cursor: pointer; }
  .graph-point.missing .graph-dot { border-color: var(--text-dim); border-style: dashed; }
  .graph-point.selected .graph-dot, .graph-point:hover .graph-dot { transform: scale(1.3); }
  .graph-point.drop-target .graph-dot { transform: scale(1.6); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.35); }

  .graph-label {
    max-width: 160px;
    overflow: hidden;
    padding: 1px 4px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--bg-panel) 82%, transparent);
    color: var(--text);
    font-size: 10px;
    text-overflow: ellipsis;
  }

  .graph-point.missing .graph-label { color: var(--text-dim); font-style: italic; }

  .graph-label-edit {
    width: 110px;
    padding: 1px 4px;
    border: 1px solid var(--accent);
    border-radius: 3px;
    outline: none;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: 10px/1.3 inherit;
    font-family: inherit;
  }

  .graph-hint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 8px;
    color: var(--text-dim);
    font-size: 10px;
    text-align: center;
    pointer-events: none;
  }

  .graph-menu {
    position: absolute;
    top: 14px;
    left: 0;
    z-index: 5;
    display: grid;
    min-width: 150px;
    gap: 3px;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
    cursor: default;
    white-space: normal;
  }

  .graph-menu button, .graph-picker input {
    box-sizing: border-box;
    padding: 4px 7px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    font-size: 10px;
    text-align: left;
    cursor: pointer;
  }

  .graph-menu button:hover, .graph-menu button:focus-visible { border-color: var(--accent); color: var(--accent); }
  .graph-menu button.danger:hover, .graph-menu button.danger:focus-visible { border-color: #c4575f; color: #f0b3b8; }
  .graph-picker { display: grid; gap: 4px; width: 190px; }
  .graph-picker input { cursor: text; }
  .graph-picker-results { display: grid; max-height: 130px; gap: 2px; overflow: auto; }
  .graph-picker-empty { color: var(--text-dim); font-size: 10px; }
</style>
