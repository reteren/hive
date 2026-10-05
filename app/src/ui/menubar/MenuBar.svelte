<script lang="ts">
  import { onMount, tick } from "svelte";
  import { formatKey } from "../../commands/keys";
  import { getCommand, runCommand } from "../../commands/registry.svelte";
  import { project } from "../../project/project.svelte";
  import { dockVisibility } from "../dockVisibility.svelte";
  import { refreshRecentProjects, recentProjectsState } from "./recentProjects.svelte";
  import { buildEditMenu, buildFileMenu, type MenuCommandItem, type MenuItem } from "./menuModel";
  import { createHoverGraceTimer } from "./hoverGraceTimer";
  import { setOpenRecentProject } from "../../project/commands";

  let { onOpenChange = () => {} } = $props<{ onOpenChange?: (open: boolean) => void }>();

  type MenuName = "file" | "edit";
  let root: HTMLDivElement;
  let openMenu = $state<MenuName | null>(null);
  let recentOpen = $state(false);
  let fileTrigger: HTMLButtonElement;
  let editTrigger: HTMLButtonElement;
  const recentCloseGrace = createHoverGraceTimer(() => {
    closeRecentSubmenu();
  });

  let fileItems = $derived(buildFileMenu(recentProjectsState.items, Boolean(project.path)));
  let editItems = $derived(buildEditMenu(dockVisibility));
  let visibleItems = $derived(openMenu === "file" ? fileItems : editItems);

  onMount(() => {
    const closeFromOutside = (event: PointerEvent) => {
      if (openMenu && event.target instanceof Node && !root.contains(event.target)) closeMenu();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      recentCloseGrace.cancel();
    };
  });

  function commandTitle(id: string): string {
    const command = getCommand(id);
    if (!command) return "";
    return command.keys.length ? `${command.label} · ${command.keys.map(formatKey).join(", ")}` : command.label;
  }

  async function open(menu: MenuName, focusFirst = false): Promise<void> {
    openMenu = menu;
    onOpenChange(true);
    closeRecentSubmenu();
    if (menu === "file") await refreshRecentProjects();
    if (focusFirst) {
      await tick();
      focusEntry("main", 0);
    }
  }

  function toggle(menu: MenuName): void {
    if (openMenu === menu) closeMenu();
    else void open(menu);
  }

  function closeMenu(restoreTrigger = false): void {
    const previous = openMenu;
    openMenu = null;
    onOpenChange(false);
    closeRecentSubmenu();
    if (restoreTrigger) (previous === "edit" ? editTrigger : fileTrigger)?.focus();
  }

  function menuButtons(path: "main" | "recent"): HTMLButtonElement[] {
    return [...root.querySelectorAll<HTMLButtonElement>(`[data-menu-focus="${path}"]:not(:disabled)`)];
  }

  function focusEntry(path: "main" | "recent", index: number): void {
    const buttons = menuButtons(path);
    if (buttons.length === 0) return;
    buttons[Math.max(0, Math.min(index, buttons.length - 1))]?.focus();
  }

  function moveFocus(path: "main" | "recent", current: HTMLButtonElement, direction: number): void {
    const buttons = menuButtons(path);
    const currentIndex = buttons.indexOf(current);
    const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
    focusEntry(path, nextIndex);
  }

  async function handleKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key === "Escape" && openMenu) {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    const trigger = event.target === fileTrigger ? "file" : event.target === editTrigger ? "edit" : null;
    if (trigger && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (openMenu === trigger) focusEntry("main", 0);
      else await open(trigger, true);
      return;
    }
    if (trigger && openMenu && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const nextMenu = trigger === "file" ? "edit" : "file";
      await open(nextMenu);
      (nextMenu === "file" ? fileTrigger : editTrigger).focus();
      return;
    }

    const current = event.target instanceof HTMLElement
      ? event.target.closest<HTMLButtonElement>("button[data-menu-focus]")
      : null;
    const path = current?.dataset.menuFocus === "recent" ? "recent" : "main";
    if (!current || !openMenu) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(path, current, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const buttons = menuButtons(path);
      focusEntry(path, event.key === "Home" ? 0 : buttons.length - 1);
    } else if (event.key === "ArrowRight" && current.dataset.submenu === "recent") {
      event.preventDefault();
      openRecentSubmenu();
      await tick();
      focusEntry("recent", 0);
    } else if (event.key === "ArrowLeft" && path === "recent") {
      event.preventDefault();
      closeRecentSubmenu();
      await tick();
      root.querySelector<HTMLButtonElement>('[data-submenu="recent"]')?.focus();
    }
  }

  function activate(item: MenuCommandItem, recentPath?: string): void {
    if (item.disabled) return;
    closeMenu();
    if (recentPath) {
      const recentProject = recentProjectsState.items.find((entry) => entry.path === recentPath);
      if (recentProject) setOpenRecentProject(recentProject);
    }
    runCommand(item.commandId);
  }

  function activateMenuItem(item: MenuItem): void {
    if (item.kind === "submenu") {
      openRecentSubmenu();
      return;
    }
    if (item.kind === "command") activate(item);
  }

  function handleSubmenuPointer(item: MenuItem): void {
    if (item.kind === "submenu") openRecentSubmenu();
  }

  function handleMainItemPointer(item: MenuItem): void {
    if (item.kind !== "submenu" && openMenu === "file") closeRecentSubmenu();
  }

  function openRecentSubmenu(): void {
    recentCloseGrace.cancel();
    recentOpen = true;
  }

  function closeRecentSubmenu(): void {
    recentCloseGrace.cancel();
    recentOpen = false;
  }

  function scheduleRecentClose(): void {
    if (recentOpen) recentCloseGrace.schedule();
  }

  function activateRecent(item: MenuItem, itemIndex: number): void {
    if (item.kind !== "command" || item.disabled) return;
    if (item.commandId === "project.clearRecent") {
      activate(item);
      return;
    }
    const recentProject = recentProjectsState.items[itemIndex];
    if (!recentProject) return;
    activate(item, recentProject.path);
  }

  function binding(id: string): string {
    return getCommand(id)?.keys.map(formatKey).join(", ") ?? "";
  }

  function itemBinding(item: MenuCommandItem): string {
    return binding(item.popupHint?.commandId ?? item.commandId);
  }

  function itemTitle(item: MenuCommandItem): string {
    if (!item.popupHint) return commandTitle(item.commandId);
    const shortcut = itemBinding(item);
    const action = shortcut ? `${shortcut} opens the list` : "no shortcut is assigned to open the list";
    return `Show ${item.popupHint.buttonLabel} button in the top-right · ${action}`;
  }
</script>

<div class="menubar" data-menubar role="menubar" aria-label="File and Edit menus" tabindex="-1" bind:this={root} onkeydown={handleKeydown}>
  <button
    bind:this={fileTrigger}
    class:active={openMenu === "file"}
    type="button"
    role="menuitem"
    aria-haspopup="menu"
    aria-expanded={openMenu === "file"}
    onclick={() => toggle("file")}
  >File</button>
  <button
    bind:this={editTrigger}
    class:active={openMenu === "edit"}
    type="button"
    role="menuitem"
    aria-haspopup="menu"
    aria-expanded={openMenu === "edit"}
    onclick={() => toggle("edit")}
  >Edit</button>

  {#if openMenu}
    <div class="menu-panel" data-menu={openMenu} role="menu" aria-label={`${openMenu} menu`}>
      {#each visibleItems as item, index (item.kind === "command" ? `${item.commandId}-${index}` : item.kind === "submenu" ? item.id : `separator-${index}`)}
        {#if item.kind === "separator"}
          <div class="separator" role="separator"></div>
        {:else if item.kind === "submenu"}
          <button
            class="menu-item submenu-trigger"
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={recentOpen}
            data-menu-item={item.id}
            data-menu-focus="main"
            data-submenu="recent"
            title={commandTitle(item.id)}
            onclick={() => activateMenuItem(item)}
            onpointerenter={() => handleSubmenuPointer(item)}
            onpointerleave={scheduleRecentClose}
          >
            <span class="check" aria-hidden="true"></span>
            <span>{item.label}</span>
            <span class="submenu-arrow" aria-hidden="true">›</span>
          </button>
        {:else}
          <button
            class="menu-item"
            class:checked={item.checked}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled ?? false}
            disabled={item.disabled ?? false}
            data-menu-item={item.commandId}
            data-menu-focus="main"
            title={itemTitle(item)}
            onclick={() => activateMenuItem(item)}
            onpointerenter={() => handleMainItemPointer(item)}
          >
            <span class="check" aria-hidden="true">{item.checked ? "✓" : ""}</span>
            <span>{item.label}</span>
            {#if itemBinding(item)}<kbd>{itemBinding(item)}</kbd>{/if}
          </button>
        {/if}
      {/each}
    </div>

    {#if openMenu === "file" && recentOpen}
      <div
        class="menu-panel recent-panel"
        data-menu="file"
        role="menu"
        tabindex="-1"
        aria-label="Open recent"
        onpointerenter={() => recentCloseGrace.cancel()}
        onpointerleave={scheduleRecentClose}
      >
        {#each fileItems as fileItem, parentIndex (parentIndex)}
          {#if fileItem.kind === "submenu"}
            {#each fileItem.items as item, itemIndex (`${item.kind}-${itemIndex}`)}
              {#if item.kind === "separator"}
                <div class="separator" role="separator"></div>
              {:else if item.kind === "command"}
                <button
                  class="menu-item"
                  type="button"
                  role="menuitem"
                  aria-disabled={item.disabled ?? false}
                  disabled={item.disabled ?? false}
                  data-menu-item={item.commandId}
                  data-menu-focus="recent"
                  title={commandTitle(item.commandId)}
                  onclick={() => activateRecent(item, itemIndex)}
                >
                  <span class="check" aria-hidden="true"></span>
                  <span>{item.label}</span>
                  {#if binding(item.commandId)}<kbd>{binding(item.commandId)}</kbd>{/if}
                </button>
              {/if}
            {/each}
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .menubar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 1px;
    flex: 0 0 auto;
  }

  .menubar > button {
    min-height: 25px;
    padding: 3px 8px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .menubar > button:hover,
  .menubar > button.active {
    border-color: #464646;
    background: #303030;
    color: var(--text);
  }

  .menu-panel {
    position: absolute;
    z-index: 40;
    top: calc(100% + 3px);
    left: 0;
    display: grid;
    width: max-content;
    min-width: 205px;
    gap: 2px;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 7px 22px #0009;
  }

  .recent-panel {
    left: 207px;
    top: calc(100% + 61px);
    min-width: 225px;
  }

  .menu-item {
    display: grid;
    grid-template-columns: 13px minmax(100px, 1fr) auto;
    min-height: 26px;
    align-items: center;
    gap: 7px;
    padding: 4px 7px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 10px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .menu-item:hover,
  .menu-item:focus-visible {
    outline: none;
    background: #383838;
  }

  .menu-item:disabled {
    color: #777;
    cursor: default;
  }

  .menu-item:disabled:hover {
    background: transparent;
  }

  .menu-item kbd {
    color: var(--text-dim);
    font: inherit;
    font-size: 9px;
  }

  .check {
    color: #e8b030;
    font-size: 11px;
    text-align: center;
  }

  .submenu-trigger {
    grid-template-columns: 13px minmax(100px, 1fr) auto;
  }

  .submenu-arrow {
    color: var(--text-dim);
    font-size: 16px;
    line-height: 12px;
  }

  .separator {
    height: 1px;
    margin: 3px 2px;
    background: var(--border);
  }
</style>
