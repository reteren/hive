<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { Action } from "svelte/action";
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
  import { addGraphPoint, fractionInRect, graphPointText, liveGraphPoints } from "./logic";
  import { addPoint, deleteGraphPoint, graphChangeCommand, graphFor, moveGraphPoint, renameGraphAxis, renameGraphPoint } from "./actions.svelte";
  import { newId } from "../model/note";
  import { t } from "../i18n/i18n.svelte";

  const MENU_MARGIN = 8;

  /** The menu lives on <body>, outside the zoomed board, so it matches the board's own menus at any zoom. */
  const portal: Action<HTMLElement> = (element) => {
    document.body.appendChild(element);
    return { destroy: () => element.remove() };
  };

  type GraphMenu =
    | { kind: "plot"; clientX: number; clientY: number; x: number; y: number; picking: boolean }
    | { kind: "point"; clientX: number; clientY: number; pointId: string };

  let { note }: { note: Note } = $props();
  let plot: HTMLDivElement | undefined = $state();
  let graph = $derived(note.graph ?? emptyGraphData());
  let points = $derived(liveGraphPoints(graph, board.notes));
  /** Live position of the point being dragged; committed as one Undo step on release. */
  let dragging = $state<{ pointId: string; pointerId: number; start: Point; x: number; y: number; moved: boolean } | null>(null);
  let editingId = $state<string | null>(null);
  let labelDraft = $state("");
  let labelInput: HTMLInputElement | undefined = $state();
  let menu = $state<GraphMenu | null>(null);
  let menuElement: HTMLDivElement | undefined = $state();
  let menuAt = $state<{ left: number; top: number } | null>(null);
  let query = $state("");
  let searchInput: HTMLInputElement | undefined = $state();
  let selectedId = $state<string | null>(null);
  let dropActive = $derived($activeDropTarget?.ownerId === `graph:${note.id}`);
  let menuPoint = $derived(menu?.kind === "point" ? points.find((point) => point.id === (menu as { pointId: string }).pointId) ?? null : null);

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
      const at = match.payload as { x: number; y: number };
      const next = addGraphPoint(graphFor(note.id), { id: newId(), x: at.x, y: at.y, label: "", targetId: ids[0] });
      return graphChangeCommand(note.id, t("Add Graph point"), next);
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
    return { ownerId: `graph:${note.id}`, targetId: note.id, payload: fractionInRect(clientX, clientY, rect) };
  }

  function position(point: GraphPoint): { x: number; y: number } {
    return dragging?.pointId === point.id ? { x: dragging.x, y: dragging.y } : point;
  }

  async function beginLabelEdit(pointId: string): Promise<void> {
    closeMenu();
    const point = points.find((item) => item.id === pointId);
    if (!point || point.targetId) return;
    editingId = pointId;
    labelDraft = point.label;
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

  function addLabelPoint(x: number, y: number): void {
    const id = addPoint(note.id, x, y);
    if (id) void beginLabelEdit(id);
  }

  function addPointAt(event: MouseEvent): void {
    if (!plot || event.target !== plot) return;
    event.preventDefault();
    event.stopPropagation();
    const at = fractionInRect(event.clientX, event.clientY, plot.getBoundingClientRect());
    addLabelPoint(at.x, at.y);
  }

  function openNode(point: GraphPoint): void {
    closeMenu();
    if (point.targetId && board.notes[point.targetId]) teleportToObject(point.targetId, { label: t("Open Graph point") });
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
    // A plain click on a node point jumps to its node.
    const point = points.find((item) => item.id === finished.pointId);
    if (point?.targetId) openNode(point);
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
      if (point.targetId) openNode(point);
      else void beginLabelEdit(point.id);
    }
  }

  async function showMenu(next: GraphMenu): Promise<void> {
    menu = next;
    menuAt = null;
    await tick();
    placeMenu();
  }

  /** Opens at the cursor and flips inward when it would leave the window. */
  function placeMenu(): void {
    if (!menu || !menuElement) return;
    const { width, height } = menuElement.getBoundingClientRect();
    const left = menu.clientX + width + MENU_MARGIN <= window.innerWidth ? menu.clientX : menu.clientX - width;
    const top = menu.clientY + height + MENU_MARGIN <= window.innerHeight ? menu.clientY : menu.clientY - height;
    menuAt = {
      left: Math.max(MENU_MARGIN, Math.min(left, window.innerWidth - width - MENU_MARGIN)),
      top: Math.max(MENU_MARGIN, Math.min(top, window.innerHeight - height - MENU_MARGIN)),
    };
  }

  function openPointMenu(point: GraphPoint, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    selectedId = point.id;
    void showMenu({ kind: "point", clientX: event.clientX, clientY: event.clientY, pointId: point.id });
  }

  function openPlotMenu(event: MouseEvent): void {
    if (!plot || event.target !== plot) return;
    event.preventDefault();
    event.stopPropagation();
    const at = fractionInRect(event.clientX, event.clientY, plot.getBoundingClientRect());
    void showMenu({ kind: "plot", clientX: event.clientX, clientY: event.clientY, x: at.x, y: at.y, picking: false });
  }

  async function startPicking(): Promise<void> {
    if (menu?.kind !== "plot") return;
    query = "";
    await showMenu({ ...menu, picking: true });
    searchInput?.focus();
  }

  function closeMenu(): void {
    menu = null;
    menuAt = null;
    query = "";
  }

  /** Menu handlers read the menu before closing it; closing re-renders the menu block away. */
  function addPointFromMenu(): void {
    if (menu?.kind !== "plot") return;
    const { x, y } = menu;
    closeMenu();
    addLabelPoint(x, y);
  }

  function deletePointFromMenu(): void {
    const pointId = menu?.kind === "point" ? menu.pointId : null;
    closeMenu();
    if (pointId) deleteGraphPoint(note.id, pointId);
  }

  function chooseNode(targetId: string): void {
    if (menu?.kind === "plot" && targetId !== note.id) addPoint(note.id, menu.x, menu.y, targetId);
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
    class:drop-target={dropActive}
    bind:this={plot}
    data-selection-ignore
    data-own-context-menu
    data-graph-plot={note.id}
    role="group"
    aria-label={t("Graph plot. Double-click to add a point.")}
    ondblclick={addPointAt}
    oncontextmenu={openPlotMenu}
  >
    {#each points as point (point.id)}
      {@const at = position(point)}
      {@const text = graphPointText(point, board.notes)}
      <div
        class="graph-point"
        class:linked={point.targetId !== null}
        class:selected={selectedId === point.id}
        class:right-label={at.x > 0.75}
        style:left={`${at.x * 100}%`}
        style:bottom={`${at.y * 100}%`}
        data-graph-point={point.id}
        data-own-context-menu
        role="button"
        tabindex="0"
        aria-label={text || t("Graph point")}
        title={point.targetId ? t("Click to open the linked node") : undefined}
        onpointerdown={(event) => beginPointDrag(point, event)}
        onpointermove={movePointDrag}
        onpointerup={(event) => endPointDrag(event)}
        onpointercancel={(event) => endPointDrag(event, true)}
        ondblclick={(event) => { event.stopPropagation(); if (!point.targetId) void beginLabelEdit(point.id); }}
        oncontextmenu={(event) => openPointMenu(point, event)}
        onkeydown={(event) => handlePointKeydown(point, event)}
        onblur={() => { if (selectedId === point.id && !menu) selectedId = null; }}
      >
        <span class="graph-dot"></span>
        {#if editingId === point.id}
          <input
            class="graph-label-edit"
            bind:this={labelInput}
            bind:value={labelDraft}
            placeholder={t("Label")}
            aria-label={t("Point label")}
            onpointerdown={(event) => event.stopPropagation()}
            onkeydown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") { event.preventDefault(); finishLabelEdit(true); }
              else if (event.key === "Escape") { event.preventDefault(); finishLabelEdit(false); }
            }}
            onblur={() => finishLabelEdit(true)}
          />
        {:else if text}
          <span class="graph-label">{text}</span>
        {/if}
      </div>
    {/each}
    {#if points.length === 0}
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

{#if menu}
  <div
    class="graph-menu"
    bind:this={menuElement}
    use:portal
    use:dismissBoardPopup={{ close: closeMenu }}
    data-graph-menu={note.id}
    role="menu"
    tabindex="-1"
    aria-label={t("Graph")}
    style:left={`${menuAt?.left ?? menu.clientX}px`}
    style:top={`${menuAt?.top ?? menu.clientY}px`}
    style:visibility={menuAt ? "visible" : "hidden"}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#if menu.kind === "plot" && menu.picking}
      <div class="graph-picker" use:listPickerInput={closeMenu}>
        <input
          bind:this={searchInput}
          bind:value={query}
          placeholder={t("Find a node…")}
          aria-label={t("Find a node to add")}
          onkeydown={(event) => event.stopPropagation()}
        />
        <div class="graph-picker-results">
          {#each choices as choice (choice.id)}
            <button type="button" role="menuitem" data-graph-target-option={choice.id} onclick={() => chooseNode(choice.id)}>{choice.name}</button>
          {:else}
            <span class="graph-picker-empty">{t("No matching board object.")}</span>
          {/each}
        </div>
      </div>
    {:else if menu.kind === "plot"}
      <button type="button" role="menuitem" onclick={addPointFromMenu}>{t("Add point")}</button>
      <button type="button" role="menuitem" onclick={() => void startPicking()}>{t("Add node…")}</button>
    {:else if menuPoint}
      {#if menuPoint.targetId}
        <button type="button" role="menuitem" onclick={() => { if (menuPoint) openNode(menuPoint); }}>{t("Open node")}</button>
      {:else}
        <button type="button" role="menuitem" onclick={() => { if (menuPoint) void beginLabelEdit(menuPoint.id); }}>{t("Rename")}</button>
      {/if}
      <div class="menu-divider"></div>
      <button type="button" role="menuitem" onclick={deletePointFromMenu}>{t("Delete point")}</button>
    {/if}
  </div>
{/if}

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
  .graph-point.selected .graph-dot, .graph-point:hover .graph-dot { transform: scale(1.3); }

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

  /* Same look as the board's own right-click menu (NotesLayer .link-context-menu). */
  .graph-menu {
    position: fixed;
    z-index: 2147483000;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-sizing: border-box;
    width: max-content;
    min-width: 168px;
    max-width: calc(100vw - 16px);
    padding: 4px;
    border: 1px solid #4c4c4c;
    border-radius: 4px;
    outline: none;
    background: var(--bg-panel);
    box-shadow: 0 5px 16px rgb(0 0 0 / 45%);
    color: var(--text);
  }

  .graph-menu button {
    display: block;
    width: 100%;
    min-width: 0;
    min-height: 28px;
    padding: 6px 8px;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .graph-menu button:hover, .graph-menu button:focus-visible { outline: none; background: var(--bg-hover); color: var(--text); }
  .graph-menu .menu-divider { height: 1px; margin: 2px 7px; background: #474747; }
  .graph-picker { display: flex; flex-direction: column; gap: 4px; width: 230px; }

  .graph-picker input {
    box-sizing: border-box;
    width: 100%;
    min-height: 28px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    outline: none;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
  }

  .graph-picker input:focus { border-color: var(--accent); }
  .graph-picker-results { display: flex; flex-direction: column; max-height: 220px; gap: 2px; overflow: auto; }
  .graph-picker-results button { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .graph-picker-empty { padding: 6px 8px; color: var(--text-dim); }
</style>
