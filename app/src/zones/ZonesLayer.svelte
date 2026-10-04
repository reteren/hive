<!-- SVG zones stay crisp at every camera zoom; the selection layer owns move/resize. -->
<script lang="ts">
  import { cachedClientRect } from "../board/boardRect";
  import { onMount, tick } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld, type Point } from "../board/cameraMath";
  import { zones } from "../model/zones.svelte";
  import type { Zone } from "../model/zone";
  import { zoneBounds, zoneNameEdge } from "../model/zone";
  import { zoneMovePreview } from "./zoneMovePreview.svelte";
  import { tool } from "../tools/tool.svelte";
  import { deleteZone, recolorZone, renameZone } from "./commands";
  import { updateZone } from "../model/zones.svelte";
  import HexColorPicker from "../color/HexColorPicker.svelte";
  import { liveColorSession, type LiveColorSession } from "../color/liveColor";
  import { startZoneMembershipSync } from "./membership.svelte";
  import { boardPopupStyle, dismissBoardPopup, fitBoardPopupAnchor } from "../ui/boardAnchor";
  import { getCommand } from "../commands/registry.svelte";
  import { formatKey } from "../commands/keys";
  import { hitTestZones } from "../selection/hitTesting";
  import { zoneMode } from "./zoneMode.svelte";
  import { menuShortcutLabel } from "../commands/menuShortcut";
  import { runZoneMenuAction, selectZoneForMenuAction } from "../commands/objectMenu";
  import { lineInteraction } from "../links/interaction.svelte";
  import OverviewLayer from "../overview/OverviewLayer.svelte";

  type Menu = { id: string; x: number; y: number; zoomAtOpen: number; rename: boolean; color?: boolean };
  let layer: HTMLDivElement;
  let surface: HTMLElement | null = null;
  let menu = $state<Menu | null>(null);
  let draftName = $state("");
  let renameInput = $state<HTMLInputElement>();
  const pathCache = new WeakMap<Zone, { parts: Zone["parts"]; holes: Zone["holes"]; value: string }>();
  const nameEdgeCache = new WeakMap<Zone, { parts: Zone["parts"]; value: ReturnType<typeof zoneNameEdge> }>();

  const transform = $derived(
    `translate(${viewport.width / 2} ${viewport.height / 2}) scale(${camera.zoom * PX_PER_UNIT}) translate(${-camera.x} ${-camera.y})`,
  );

  function pathFor(zone: Zone): string {
    const cached = pathCache.get(zone);
    if (cached?.parts === zone.parts && cached.holes === zone.holes) return cached.value;
    const value = [...zone.parts, ...zone.holes].map((polygon) => polygon.length
      ? `M ${polygon.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`
      : "").join(" ");
    pathCache.set(zone, { parts: zone.parts, holes: zone.holes, value });
    return value;
  }

  function cachedNameEdge(zone: Zone): ReturnType<typeof zoneNameEdge> {
    const cached = nameEdgeCache.get(zone);
    if (cached?.parts === zone.parts) return cached.value;
    const value = zoneNameEdge(zone);
    nameEdgeCache.set(zone, { parts: zone.parts, value });
    return value;
  }

  function previewTransform(id: string): string | undefined {
    if (zoneMovePreview.zoneId !== id) return undefined;
    return `translate(${zoneMovePreview.offset.x} ${zoneMovePreview.offset.y})`;
  }

  function local(clientX: number, clientY: number): Point {
    const rect = cachedClientRect(surface!);
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function openMenu(id: string, point: Point, rename = false): void {
    const zone = zones.byId[id];
    if (!zone) return;
    draftName = zone.name;
    const world = screenToWorld(camera, viewport, point);
    const zoomAtOpen = camera.zoom;
    const anchor = fitBoardPopupAnchor(camera, viewport, world, { width: 220, height: 320 });
    menu = {
      id,
      x: anchor.x,
      y: anchor.y,
      zoomAtOpen,
      rename,
    };
    if (rename) void tick().then(() => { renameInput?.focus(); renameInput?.select(); });
  }

  let colorSession: LiveColorSession | null = null;

  function startRecolor(): void {
    const zone = menu ? zones.byId[menu.id] : undefined;
    if (!menu || !zone) return;
    const id = zone.id;
    colorSession?.finish(true);
    colorSession = liveColorSession(zone.color, (color) => updateZone(id, { color }), (color) => recolorZone(id, color));
    menu.color = true;
    void tick().then(() => layer.querySelector<HTMLElement>(".zone-color-popup")?.focus());
  }

  // Any way the colour popup closes (outside click, another menu) keeps the picked colour; Esc restores it.
  $effect(() => {
    if (!menu?.color && colorSession) {
      colorSession.finish(true);
      colorSession = null;
    }
  });

  function cancelRecolor(): void {
    colorSession?.finish(false);
    colorSession = null;
    menu = null;
  }

  function startRename(): void {
    if (!menu) return;
    menu.rename = true;
    void tick().then(() => { renameInput?.focus(); renameInput?.select(); });
  }

  function startUniversalZoneAction(action: "scale" | "grab" | "delete", event?: MouseEvent): void {
    if (!menu) return;
    const id = menu.id;
    const startWorld = action === "grab" && event
      ? screenToWorld(camera, viewport, local(event.clientX, event.clientY))
      : undefined;
    menu = null;
    if (action === "delete") {
      if (selectZoneForMenuAction(id)) deleteZone(id);
    } else {
      runZoneMenuAction(id, action, startWorld);
    }
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
      const lineToolActive = tool.active === "line-strong" || tool.active === "line-weak";
      if (lineToolActive && performance.now() < lineInteraction.suppressContextMenuUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (tool.active !== "select" && !(tool.active === "zone" && zoneMode.active === "move") && !lineToolActive) return;
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
  <OverviewLayer />
  <svg class="zone-svg" width="100%" height="100%" aria-label="Zones">
    <g transform={transform}>
      {#each zones.order as id (id)}
        {@const zone = zones.byId[id]}
        {#if zone}
          {@const nameEdge = cachedNameEdge(zone)}
          <g
            data-zone-id={id}
            data-moving={zoneMovePreview.zoneId === id ? "true" : undefined}
            transform={previewTransform(id)}
          >
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
            <!-- The Alt overview label of a zone is drawn by OverviewZoneLabels, above the nodes. -->
          </g>
        {/if}
      {/each}
    </g>
  </svg>
  {#if menu && zones.byId[menu.id]}
    <div class="zone-menu" data-zone-menu data-selection-ignore role="menu" aria-label="Zone actions"
      style={boardPopupStyle(camera, viewport, { x: menu.x, y: menu.y }, menu.zoomAtOpen)}
      use:dismissBoardPopup={{ close: () => { menu = null; }, escape: false }}>
      {#if menu.color}
        <div class="zone-color-popup" role="dialog" aria-label="Zone colour" tabindex="-1" onkeydown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelRecolor(); }
          else if (event.key === "Enter" && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); menu = null; }
        }}>
          <span class="zone-color-title">{zones.byId[menu.id].name}</span>
          <HexColorPicker
            value={zones.byId[menu.id].color}
            label="Zone colour"
            oninput={(color) => colorSession?.preview(color)}
            onchange={(color) => colorSession?.preview(color)}
          />
        </div>
      {:else if menu.rename}
        <input bind:this={renameInput} bind:value={draftName} aria-label="Zone name" onkeydown={(event) => {
          if (event.code === "Enter") { event.preventDefault(); commitRename(); }
          else if (event.code === "Escape") { event.preventDefault(); menu = null; }
        }} onblur={commitRename} />
      {:else}
        <button type="button" role="menuitem" onclick={startRename}>Rename</button>
        <button type="button" role="menuitem" onclick={startRecolor}>Change color</button>
        <div class="zone-menu-divider" role="separator"></div>
        <button class="zone-menu-command" type="button" role="menuitem" onclick={() => startUniversalZoneAction("scale")}>
          <span>Scale</span><span class="zone-menu-shortcut">{menuShortcutLabel("select.scale")}</span>
        </button>
        <button class="zone-menu-command" type="button" role="menuitem" onclick={(event) => startUniversalZoneAction("grab", event)}>
          <span>Grab</span><span class="zone-menu-shortcut">{menuShortcutLabel("select.move")}</span>
        </button>
        <button class="zone-menu-command" type="button" role="menuitem" onclick={() => startUniversalZoneAction("delete")}>
          <span>Delete</span><span class="zone-menu-shortcut">{menuShortcutLabel("edit.delete")}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .zones-layer, .zone-svg { position: absolute; inset: 0; pointer-events: none; }
  .zone-svg { overflow: visible; }
  .zone-svg [data-moving="true"] { opacity: 0.7; }
  .zone-name { font-size: 1.15px; font-weight: 650; paint-order: stroke; stroke: #17191d; stroke-width: 0.25px; cursor: text; outline: none; }
  .zone-name:focus-visible { text-decoration: underline; text-decoration-thickness: 0.12px; text-underline-offset: 0.2px; }
  .zone-menu { position: absolute; z-index: 30; display: flex; width: 220px; flex-direction: column; gap: 3px; padding: 5px; border: 1px solid #4c4c4c; border-radius: 4px; color: var(--text); background: #242424; box-shadow: 0 5px 16px #0008; pointer-events: auto; }
  .zone-menu > button { min-height: 27px; padding: 4px 7px; border: 0; border-radius: 3px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
  .zone-menu > button:hover { background: #393939; }
  .zone-menu > .zone-menu-command { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .zone-menu-shortcut { flex: 0 0 auto; color: #8a8a8a; font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .zone-menu-command:hover .zone-menu-shortcut { color: #c4c4c4; }
  .zone-menu-divider { height: 1px; margin: 2px 7px; background: #474747; }
  .zone-menu input { width: 100%; box-sizing: border-box; padding: 5px; border: 1px solid var(--accent); border-radius: 2px; color: var(--text); background: #202020; }
  .zone-color-popup { display: grid; gap: 7px; padding: 4px; outline: none; }
  .zone-color-title { overflow: hidden; color: var(--text-dim); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
</style>
