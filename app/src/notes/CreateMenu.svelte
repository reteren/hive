<script lang="ts">
  import { camera, viewport } from "../board/camera.svelte";
  import { createNote, createNoteKind } from "./noteCommands";
  import { R5_KINDS } from "../model/note";
  import { creationMenu, closeCreationMenu } from "./creation.svelte";
  import { boardPopupStyle, dismissBoardPopup } from "../ui/boardAnchor";

  const menuStyle = $derived(boardPopupStyle(camera, viewport, creationMenu.menuAnchor));

  function createNoteFromMenu(): void {
    createNote();
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function createMiniNodeFromMenu(kind: "pro" | "con"): void {
    createNoteKind(kind);
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function createModuleFromMenu(kind: "importance" | "purpose" | "mood"): void {
    createNoteKind(kind);
    if (!creationMenu.pinned) closeCreationMenu();
  }

  const R5_LABELS: Record<(typeof R5_KINDS)[number], string> = {
    goal: "Goal",
    progress: "Progress",
    calculator: "Calculator",
    tierlist: "Tierlist",
    stats: "Statistics",
  };

  function createR5FromMenu(kind: (typeof R5_KINDS)[number]): void {
    createNoteKind(kind);
    if (!creationMenu.pinned) closeCreationMenu();
  }

  function createBeaconFromMenu(): void {
    createNoteKind("beacon");
    if (!creationMenu.pinned) closeCreationMenu();
  }
</script>

{#if creationMenu.open}
  <aside
    class="create-menu"
    data-create-menu
    data-selection-ignore
    aria-label="Create list"
    style={menuStyle}
    use:dismissBoardPopup={{ close: closeCreationMenu }}
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
      <button class="create-item" type="button" onclick={() => createMiniNodeFromMenu("pro")}>
        <span class="kind-icon plus-icon" aria-hidden="true">+</span>
        <span>Plus</span>
      </button>
      <button class="create-item" type="button" onclick={() => createMiniNodeFromMenu("con")}>
        <span class="kind-icon minus-icon" aria-hidden="true">−</span>
        <span>Minus</span>
      </button>
      <button class="create-item" type="button" onclick={() => createModuleFromMenu("importance")}>
        <span class="module-icon importance-icon" aria-hidden="true"></span>
        <span>Importance</span>
      </button>
      <button class="create-item" type="button" onclick={() => createModuleFromMenu("purpose")}>
        <span class="module-icon purpose-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="M8 2.5 13.5 8 8 13.5 2.5 8zM8 5v6M5 8h6" /></svg>
        </span>
        <span>Purpose</span>
      </button>
      <button class="create-item" type="button" onclick={() => createModuleFromMenu("mood")}>
        <span class="module-icon mood-icon" aria-hidden="true"></span>
        <span>Mood</span>
      </button>
      <button class="create-item" type="button" onclick={createBeaconFromMenu}>
        <span class="beacon-icon" aria-hidden="true"></span>
        <span>Beacon</span>
      </button>
      {#each R5_KINDS as kind (kind)}
        <button class="create-item" type="button" data-create-kind={kind} onclick={() => createR5FromMenu(kind)}>
          <span class="r5-icon" aria-hidden="true"></span>
          <span>{R5_LABELS[kind]}</span>
        </button>
      {/each}
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

  .kind-icon {
    display: grid;
    width: 15px;
    height: 15px;
    place-items: center;
    border: 1px solid currentColor;
    border-radius: 3px;
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
  }

  .plus-icon {
    color: #83c38f;
    background: #263b2d;
  }

  .minus-icon {
    color: #dc8884;
    background: #3b2928;
  }

  .module-icon {
    display: grid;
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    place-items: center;
  }

  .importance-icon {
    width: 9px;
    height: 9px;
    margin-inline: 3px;
    border: 1px solid #eee;
    border-radius: 50%;
    background: #d6d6d6;
    box-shadow: 0 0 5px rgb(214 214 214 / 35%);
  }

  .purpose-icon {
    color: #70b5a1;
  }

  .mood-icon::before {
    width: 9px;
    height: 9px;
    border: 1px solid #fff0b0;
    border-radius: 50%;
    background: #f1c85b;
    content: "";
  }

  .purpose-icon svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.4;
  }

  /* Placeholder glyph for R5 kinds; each kind's owner may give it a proper icon later. */
  .r5-icon {
    width: 11px;
    height: 11px;
    flex: 0 0 auto;
    border: 1.5px solid var(--text-dim);
    border-radius: 3px;
  }

  .beacon-icon {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: #e8b030;
    box-shadow: 0 0 0 2px rgb(232 176 48 / 18%);
  }
</style>
