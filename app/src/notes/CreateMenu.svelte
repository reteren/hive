<script lang="ts">
  import { viewport } from "../board/camera.svelte";
  import { createNote } from "./noteCommands";
  import { createMenuPosition } from "./creationPosition";
  import { creationMenu, closeCreationMenu } from "./creation.svelte";

  const menuPosition = $derived(createMenuPosition(
    creationMenu.screenAnchor,
    viewport,
    { width: 164, height: 74 },
  ));

  function createNoteFromMenu(): void {
    createNote();
    if (!creationMenu.pinned) closeCreationMenu();
  }
</script>

{#if creationMenu.open}
  <aside
    class="create-menu"
    data-create-menu
    data-selection-ignore
    aria-label="Create list"
    style:left={`${menuPosition.x}px`}
    style:top={`${menuPosition.y}px`}
  >
    <header class="menu-header">
      <span>Create</span>
      <div class="menu-actions">
        <button
          class="menu-action pin-button"
          type="button"
          aria-label={creationMenu.pinned ? "Unpin create list" : "Pin create list"}
          aria-pressed={creationMenu.pinned}
          title={creationMenu.pinned ? "Unpin list" : "Keep list open after creating"}
          onclick={() => (creationMenu.pinned = !creationMenu.pinned)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 2.5h6l-.8 3 2.3 2.2v1H3.5v-1l2.3-2.2zM8 8.7v4.8" />
          </svg>
        </button>
        <button
          class="menu-action close-button"
          type="button"
          aria-label="Close create list"
          title="Close"
          onclick={closeCreationMenu}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </header>
    <div class="create-items">
      <button class="create-item" type="button" onclick={createNoteFromMenu}>
        <span class="note-icon" aria-hidden="true"></span>
        <span>Note</span>
      </button>
    </div>
  </aside>
{/if}

<style>
  .create-menu {
    position: absolute;
    z-index: 30;
    width: 164px;
    overflow: hidden;
    color: var(--text);
    background: #282828;
    border: 1px solid #4b4b4b;
    border-radius: 4px;
    box-shadow: 0 6px 20px rgb(0 0 0 / 42%);
  }

  .menu-header {
    display: flex;
    height: 30px;
    align-items: center;
    justify-content: space-between;
    padding: 0 5px 0 9px;
    color: var(--text-dim);
    background: #222;
    border-bottom: 1px solid #414141;
    font-size: 11px;
    font-weight: 600;
  }

  .menu-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .menu-action {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    padding: 0;
    color: var(--text-dim);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
  }

  .menu-action:hover,
  .menu-action[aria-pressed="true"] {
    color: var(--text);
    background: var(--bg-hover);
    border-color: #4a4a4a;
  }

  .menu-action svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.35;
  }

  .create-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px;
  }

  .create-item {
    display: flex;
    min-height: 30px;
    align-items: center;
    gap: 8px;
    padding: 0 7px;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
  }

  .create-item:hover {
    background: var(--bg-hover);
    border-color: #4a4a4a;
  }

  .note-icon {
    width: 13px;
    height: 15px;
    background: #3a3a3a;
    border: 1px solid #929292;
    border-radius: 2px;
    box-shadow: inset 0 -3px 0 #303030;
  }
</style>
