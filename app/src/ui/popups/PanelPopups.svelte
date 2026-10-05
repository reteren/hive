<script lang="ts">
  import { onMount, tick } from "svelte";
  import { commands, runCommand } from "../../commands/registry.svelte";
  import { findMatchingCommand } from "../../commands/keys";
  import { closeCommandSearch, commandSearchState } from "../../commands/commandSearch.svelte";
  import { closeSearch, searchState } from "../../search/search.svelte";
  import { closePanelPopup, hasFloatingPopupOpen, panelPopupState, togglePanelPopup, type PanelPopupId } from "./panelPopupState.svelte";
  import UndoLogPopup from "./UndoLogPopup.svelte";
  import TasksPopup from "./TasksPopup.svelte";
  import TrashPopup from "./TrashPopup.svelte";
  import ObjectsPopup from "./ObjectsPopup.svelte";

  let surface = $state<HTMLDivElement>();

  const popupCommandIds: Record<string, PanelPopupId> = {
    "ui.toggleUndoLog": "undo-log",
    "ui.toggleTasks": "tasks",
    "ui.openTrash": "trash",
    "ui.toggleObjectsPanel": "objects",
  };

  $effect(() => {
    const active = panelPopupState.active;
    if (!active) return;
    void tick().then(() => {
      const root = surface?.querySelector<HTMLElement>(`[data-panel-popup="${active}"]`);
      const target = root?.querySelector<HTMLElement>(
        "input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      (target ?? root)?.focus();
    });
  });

  function routePopupShortcuts(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !hasFloatingPopupOpen()) return;
    const command = findMatchingCommand(event, commands.values());
    if (!command) return;

    const popupId = popupCommandIds[command.id];
    if (popupId) {
      event.preventDefault();
      togglePanelPopup(popupId);
      return;
    }

    if (command.id !== "search.open" && command.id !== "ui.commandSearch") return;
    const switchesSearch = command.id === "search.open" && commandSearchState.open;
    const switchesCommandSearch = command.id === "ui.commandSearch" && searchState.open;
    if (!panelPopupState.active && !switchesSearch && !switchesCommandSearch) return;

    event.preventDefault();
    closePanelPopup(false);
    if (command.id === "search.open") closeCommandSearch();
    else closeSearch();
    runCommand(command.id);
  }

  onMount(() => {
    window.addEventListener("keydown", routePopupShortcuts, true);
    return () => window.removeEventListener("keydown", routePopupShortcuts, true);
  });
</script>

<div bind:this={surface}>
  {#if panelPopupState.active === "undo-log"}
    <UndoLogPopup />
  {:else if panelPopupState.active === "tasks"}
    <TasksPopup />
  {:else if panelPopupState.active === "trash"}
    <TrashPopup />
  {:else if panelPopupState.active === "objects"}
    <ObjectsPopup />
  {/if}
</div>
