<!-- SVG zones stay crisp at every camera zoom; the selection layer owns move/resize. -->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld, type Point } from "../board/cameraMath";
  import { isTextEditingTarget } from "../commands/focus";
  import { zones } from "../model/zones.svelte";
  import type { Zone } from "../model/zone";
  import { zoneBounds } from "../model/zone";
  import { tool } from "../tools/tool.svelte";
  import { createZone, deleteZone, recolorZone, renameZone, ZONE_COLORS } from "./commands";
  import { startZoneMembershipSync } from "./membership.svelte";
  import { zoneCreationPreview, zoneTouchesRect } from "./geometry";

  type Menu = { id: string; x: number; y: number; rename: boolean };
  type Drag = { pointerId: number; start: Point; end: Point; cursor: Point };
  let layer: HTMLDivElement;
  let surface: HTMLElement | null = null;
  let drag = $state<Drag | null>(null);
  let menu = $state<Menu | null>(null);
  let draftName = $state("");
  let renameInput = $state<HTMLInputElement>();
  let error = $state<{ message: string; x: number; y: number } | null>(null);
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  const transform = $derived(
    `translate(${viewport.width / 2} ${viewport.height / 2}) scale(${camera.zoom * PX_PER_UNIT}) translate(${-camera.x} ${-camera.y})`,
  );
  const preview = $derived(drag
    ? zoneCreationPreview(drag.start, drag.end, Object.values(zones.byId))
    : null);

  function pathFor(zone: Zone): string {
    return [...zone.parts, ...zone.holes].map((polygon) => polygon.length
      ? `M ${polygon.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`
      : "").join(" ");
  }

  function local(clientX: number, clientY: number): Point {
    const rect = surface!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function showError(message: string, point: Point): void {
    if (errorTimer) clearTimeout(errorTimer);
    error = { message, x: point.x, y: point.y };
    errorTimer = setTimeout(() => { error = null; errorTimer = null; }, 2_000);
  }

  function openMenu(id: string, point: Point, rename = false): void {
    const zone = zones.byId[id];
    if (!zone) return;
    draftName = zone.name;
    menu = {
      id,
      x: Math.max(8, Math.min(point.x, viewport.width - 190)),
      y: Math.max(8, Math.min(point.y, viewport.height - 158)),
      rename,
    };
    if (rename) void tick().then(() => { renameInput?.focus(); renameInput?.select(); });
  }

  function commitRename(): void {
    if (!menu) return;
    renameZone(menu.id, draftName);
    menu = null;
  }

  function zoneAt(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    const id = target.closest<SVGGElement>("[data-zone-id]")?.dataset.zoneId;
    return id && zones.byId[id] ? id : null;
  }

  function labelAt(clientX: number, clientY: number): string | null {
    const labels = [...layer.querySelectorAll<SVGTextElement>(".zone-name")];
    for (const id of [...zones.order].reverse()) {
      const label = labels.find((element) => element.closest("[data-zone-id]")?.getAttribute("data-zone-id") === id);
      if (!label) continue;
      const rect = label.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return id;
    }
    return null;
  }

  onMount(() => {
    startZoneMembershipSync();
    surface = layer.parentElement;
    if (!surface) return;

    function onPointerDown(event: PointerEvent): void {
      if (menu && !(event.target instanceof Element && event.target.closest("[data-zone-menu]"))) menu = null;
      if (tool.active !== "zone" || event.button !== 0 || isTextEditingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-note-id], [data-beacon-id], [data-link-id], [data-selection-ignore], button, input")) return;
      const cursor = local(event.clientX, event.clientY);
      const world = screenToWorld(camera, viewport, cursor);
      if (Object.values(zones.byId).some((zone) => zoneTouchesRect(zone, { x: world.x, y: world.y, width: 0, height: 0 }))) {
        showError("Start outside an existing zone", cursor);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = { pointerId: event.pointerId, start: world, end: world, cursor };
      surface?.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent): void {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const cursor = local(event.clientX, event.clientY);
      drag.end = screenToWorld(camera, viewport, cursor);
      drag.cursor = cursor;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function finish(event: PointerEvent): void {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const cursor = local(event.clientX, event.clientY);
      const end = screenToWorld(camera, viewport, cursor);
      const result = zoneCreationPreview(drag.start, end, Object.values(zones.byId));
      drag = null;
      if (surface?.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
      if (result.blocked && result.reason) showError(result.reason, cursor);
      const rect = result.rect;
      if (rect && rect.width >= 2 && rect.height >= 2 && !createZone(rect)) showError("Zone cannot be placed here", cursor);
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function cancel(event: PointerEvent): void {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
    }

    function onContextMenu(event: MouseEvent): void {
      const id = zoneAt(event.target);
      if (!id || tool.active !== "select") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openMenu(id, local(event.clientX, event.clientY));
    }

    function onDoubleClick(event: MouseEvent): void {
      if (tool.active !== "select" || !(event.target instanceof Element) ||
        event.target.closest("[data-note-id], [data-beacon-id], [data-link-id]")) return;
      const id = labelAt(event.clientX, event.clientY);
      if (!id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openMenu(id, local(event.clientX, event.clientY), true);
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.code !== "Escape" || event.defaultPrevented) return;
      if (menu) { menu = null; event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (tool.active !== "zone") return;
      drag = null;
      tool.active = "select";
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    surface.addEventListener("pointerdown", onPointerDown, true);
    surface.addEventListener("contextmenu", onContextMenu, true);
    surface.addEventListener("dblclick", onDoubleClick, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      surface?.removeEventListener("pointerdown", onPointerDown, true);
      surface?.removeEventListener("contextmenu", onContextMenu, true);
      surface?.removeEventListener("dblclick", onDoubleClick, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", onKeyDown, true);
      if (errorTimer) clearTimeout(errorTimer);
    };
  });
</script>

<div class="zones-layer" bind:this={layer}>
  <svg class="zone-svg" width="100%" height="100%" aria-label="Zones">
    <g transform={transform}>
      {#each zones.order as id (id)}
        {@const zone = zones.byId[id]}
        {#if zone}
          {@const bounds = zoneBounds(zone)}
          <g data-zone-id={id}>
            <path
              d={pathFor(zone)}
              fill={zone.color}
              fill-opacity="0.12"
              fill-rule="evenodd"
              stroke={zone.color}
              stroke-width="1.5"
              vector-effect="non-scaling-stroke"
              style:pointer-events={tool.active === "select" ? "visiblePainted" : "none"}
            />
            <text
              x={bounds.x + 0.8}
              y={bounds.y + 1.7}
              fill={zone.color}
              class="zone-name"
              role="button"
              tabindex="0"
              aria-label={`Rename ${zone.name}`}
              style:pointer-events={tool.active === "select" ? "visiblePainted" : "none"}
              onkeydown={(event) => { if (event.code === "Enter") { event.preventDefault(); openMenu(id, { x: 12, y: 12 }, true); } }}
            >{zone.name}</text>
          </g>
        {/if}
      {/each}
      {#if preview?.rect}
        {@const rect = preview.rect}
        <rect class="zone-preview" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
      {/if}
    </g>
  </svg>
  {#if drag && preview?.blocked && preview.reason}
    <div class="zone-feedback" data-selection-ignore role="status" style:left={`${drag.cursor.x + 12}px`} style:top={`${drag.cursor.y + 12}px`}>{preview.reason}</div>
  {:else if error}
    <div class="zone-feedback" data-selection-ignore role="status" style:left={`${error.x + 12}px`} style:top={`${error.y + 12}px`}>{error.message}</div>
  {/if}
  {#if menu && zones.byId[menu.id]}
    <div class="zone-menu" data-zone-menu data-selection-ignore role="menu" aria-label="Zone actions" style:left={`${menu.x}px`} style:top={`${menu.y}px`}>
      {#if menu.rename}
        <input bind:this={renameInput} bind:value={draftName} aria-label="Zone name" onkeydown={(event) => {
          if (event.code === "Enter") { event.preventDefault(); commitRename(); }
          else if (event.code === "Escape") { event.preventDefault(); menu = null; }
        }} onblur={commitRename} />
      {:else}
        <button type="button" role="menuitem" onclick={() => { if (menu) openMenu(menu.id, { x: menu.x, y: menu.y }, true); }}>Rename</button>
        <div class="zone-colours" aria-label="Zone colour">
          <span>Colour</span>
          {#each ZONE_COLORS as color}
            <button type="button" class="colour" style:background={color} aria-label={`Set zone colour ${color}`} onclick={() => { if (menu) recolorZone(menu.id, color); menu = null; }}></button>
          {/each}
        </div>
        <button type="button" role="menuitem" onclick={() => { if (menu) deleteZone(menu.id); menu = null; }}>Delete zone</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .zones-layer, .zone-svg { position: absolute; inset: 0; pointer-events: none; }
  .zone-svg { overflow: visible; }
  .zone-name { font-size: 1.15px; font-weight: 650; paint-order: stroke; stroke: #17191d; stroke-width: 0.25px; cursor: text; outline: none; }
  .zone-name:focus-visible { text-decoration: underline; text-decoration-thickness: 0.12px; text-underline-offset: 0.2px; }
  .zone-preview { fill: #739abc; fill-opacity: 0.12; stroke: #9bbbd8; stroke-width: 1.5px; stroke-dasharray: 5 4; vector-effect: non-scaling-stroke; pointer-events: none; }
  .zone-feedback { position: absolute; z-index: 30; max-width: 220px; padding: 5px 7px; border: 1px solid #8c6d40; border-radius: 4px; color: #f5dbab; background: #302b23; font-size: 11px; pointer-events: none; }
  .zone-menu { position: absolute; z-index: 30; display: flex; width: 176px; flex-direction: column; gap: 3px; padding: 5px; border: 1px solid #4c4c4c; border-radius: 4px; color: var(--text); background: #242424; box-shadow: 0 5px 16px #0008; pointer-events: auto; }
  .zone-menu > button { min-height: 27px; padding: 4px 7px; border: 0; border-radius: 3px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
  .zone-menu > button:hover { background: #393939; }
  .zone-menu input { width: 100%; box-sizing: border-box; padding: 5px; border: 1px solid var(--accent); border-radius: 2px; color: var(--text); background: #202020; }
  .zone-colours { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; }
  .zone-colours span { flex-basis: 100%; color: var(--text-dim); font-size: 10px; }
  .zone-colours .colour { width: 20px; height: 20px; border: 1px solid #ffffff70; border-radius: 3px; cursor: pointer; }
</style>
