<!-- SVG zones stay crisp at every camera zoom; the selection layer owns move/resize. -->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld, type Point } from "../board/cameraMath";
  import { zones } from "../model/zones.svelte";
  import type { Zone } from "../model/zone";
  import { zoneNameEdge } from "../model/zone";
  import { tool } from "../tools/tool.svelte";
  import { deleteZone, recolorZone, renameZone, ZONE_COLORS } from "./commands";
  import { startZoneMembershipSync } from "./membership.svelte";
  import { boardPopupStyle, dismissBoardPopup, fitBoardPopupAnchor } from "../ui/boardAnchor";
  import { getCommand } from "../commands/registry.svelte";
  import { formatKey } from "../commands/keys";
  import { hitTestZones } from "../selection/hitTesting";
  import { requestZoneMove, zoneMode } from "./zoneMode.svelte";

  type Menu = { id: string; x: number; y: number; rename: boolean };
  let layer: HTMLDivElement;
  let surface: HTMLElement | null = null;
  let menu = $state<Menu | null>(null);
  let draftName = $state("");
  let renameInput = $state<HTMLInputElement>();
  const moveKeys = $derived(getCommand("select.move")?.keys.map(formatKey).join(", ") ?? "");

  const transform = $derived(
    `translate(${viewport.width / 2} ${viewport.height / 2}) scale(${camera.zoom * PX_PER_UNIT}) translate(${-camera.x} ${-camera.y})`,
  );

  function pathFor(zone: Zone): string {
    return [...zone.parts, ...zone.holes].map((polygon) => polygon.length
      ? `M ${polygon.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`
      : "").join(" ");
  }

  function local(clientX: number, clientY: number): Point {
    const rect = surface!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function openMenu(id: string, point: Point, rename = false): void {
    const zone = zones.byId[id];
    if (!zone) return;
    draftName = zone.name;
    const world = screenToWorld(camera, viewport, point);
    const anchor = fitBoardPopupAnchor(camera, viewport, world, { width: 176, height: 190 });
    menu = {
      id,
      x: anchor.x,
      y: anchor.y,
      rename,
    };
    if (rename) void tick().then(() => { renameInput?.focus(); renameInput?.select(); });
  }

  function startRename(): void {
    if (!menu) return;
    menu.rename = true;
    void tick().then(() => { renameInput?.focus(); renameInput?.select(); });
  }

  function startMoveFromMenu(event: MouseEvent): void {
    if (!menu) return;
    const id = menu.id;
    const point = screenToWorld(camera, viewport, local(event.clientX, event.clientY));
    menu = null;
    requestZoneMove({ zoneId: id, startWorld: point });
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
      const rect = (label.parentElement ?? label).getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return id;
    }
    return null;
  }

  onMount(() => {
    startZoneMembershipSync();
    surface = layer.parentElement;
    if (!surface) return;

    function onContextMenu(event: MouseEvent): void {
      if (performance.now() < zoneMode.suppressContextMenuUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (tool.active !== "select" && !(tool.active === "zone" && zoneMode.active === "move")) return;
      if (event.target instanceof Element && event.target.closest("[data-note-id], [data-beacon-id], [data-link-id], [data-selection-ignore]")) return;
      const point = local(event.clientX, event.clientY);
      const id = zoneAt(event.target) ?? hitTestZones(screenToWorld(camera, viewport, point), zones.byId, zones.order);
      if (!id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openMenu(id, point);
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
    }

    surface.addEventListener("contextmenu", onContextMenu, true);
    surface.addEventListener("dblclick", onDoubleClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      surface?.removeEventListener("contextmenu", onContextMenu, true);
      surface?.removeEventListener("dblclick", onDoubleClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  });
</script>

<div class="zones-layer" bind:this={layer}>
  <svg class="zone-svg" width="100%" height="100%" aria-label="Zones">
    <g transform={transform}>
      {#each zones.order as id (id)}
        {@const zone = zones.byId[id]}
        {#if zone}
          {@const nameEdge = zoneNameEdge(zone)}
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
            <svg x={nameEdge.x} y={nameEdge.y} width={nameEdge.width} height="2.4" overflow="hidden">
              <text
                x="0.8"
                y="1.7"
                fill={zone.color}
                class="zone-name"
                role="button"
                tabindex="0"
                aria-label={`Rename ${zone.name}`}
                style:pointer-events={tool.active === "select" ? "visiblePainted" : "none"}
                onkeydown={(event) => { if (event.code === "Enter") {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenu(id, local(rect.left, rect.bottom), true);
                } }}
              >{zone.name}</text>
            </svg>
          </g>
        {/if}
      {/each}
    </g>
  </svg>
  {#if menu && zones.byId[menu.id]}
    <div class="zone-menu" data-zone-menu data-selection-ignore role="menu" aria-label="Zone actions"
      style={boardPopupStyle(camera, viewport, { x: menu.x, y: menu.y })}
      use:dismissBoardPopup={{ close: () => { menu = null; }, escape: false }}>
      {#if menu.rename}
        <input bind:this={renameInput} bind:value={draftName} aria-label="Zone name" onkeydown={(event) => {
          if (event.code === "Enter") { event.preventDefault(); commitRename(); }
          else if (event.code === "Escape") { event.preventDefault(); menu = null; }
        }} onblur={commitRename} />
      {:else}
        <button type="button" role="menuitem" data-zone-move-menu onclick={startMoveFromMenu}>Move zone{moveKeys ? ` (${moveKeys})` : ""}</button>
        <button type="button" role="menuitem" onclick={startRename}>Rename</button>
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
  .zone-menu { position: absolute; z-index: 30; display: flex; width: 176px; flex-direction: column; gap: 3px; padding: 5px; border: 1px solid #4c4c4c; border-radius: 4px; color: var(--text); background: #242424; box-shadow: 0 5px 16px #0008; pointer-events: auto; }
  .zone-menu > button { min-height: 27px; padding: 4px 7px; border: 0; border-radius: 3px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
  .zone-menu > button:hover { background: #393939; }
  .zone-menu input { width: 100%; box-sizing: border-box; padding: 5px; border: 1px solid var(--accent); border-radius: 2px; color: var(--text); background: #202020; }
  .zone-colours { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; }
  .zone-colours span { flex-basis: 100%; color: var(--text-dim); font-size: 10px; }
  .zone-colours .colour { width: 20px; height: 20px; border: 1px solid #ffffff70; border-radius: 3px; cursor: pointer; }
</style>
