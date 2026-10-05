<script lang="ts">
  import { closeTrashPanel, trashPanel } from "./trashPanelState.svelte";
  import TrashList from "./TrashList.svelte";
  import { closePanelPopup, panelPopupState } from "../ui/popups/panelPopupState.svelte";
  import "./uiInit";

  let { variant = "dock" } = $props<{ variant?: "dock" | "popup" }>();
  let isOpen = $derived(variant === "popup" ? panelPopupState.active === "trash" : trashPanel.open);

  function closeOnEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closeCurrentPanel();
  }

  function closeCurrentPanel(): void {
    if (variant === "popup") closePanelPopup();
    else closeTrashPanel();
  }
</script>

{#if isOpen}
  <dialog open id="trash-panel" class="trash-panel" class:popup-panel={variant === "popup"} data-selection-ignore aria-label="Trash" aria-modal={variant === "popup"} onkeydown={closeOnEscape}>
    <header class="panel-heading">
      <div class="panel-title">
        <h2>Trash</h2>
      </div>
      <button class="panel-control close" type="button" aria-label="Close trash panel" title="Close" onclick={closeCurrentPanel}>×</button>
    </header>
    <TrashList />
  </dialog>
{/if}

<style>
  .trash-panel {
    display: flex;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #080808;
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
    color: var(--text);
    pointer-events: auto;
  }

  .panel-heading {
    display: flex;
    min-height: 34px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 6px 3px 10px;
    border-bottom: 1px solid #3b3b3b;
  }

  .panel-title h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }

  .panel-control {
    min-width: 24px;
    min-height: 24px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }

  .panel-control:hover,
  .panel-control:focus-visible {
    border-color: #4a4a4a;
    background: #303030;
    color: var(--text);
  }
</style>
