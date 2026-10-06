<!-- Objects panel with navigation (R2.6). Owns its own open/closed state and toggle button. -->
<script lang="ts">
  import { board } from "../model/board.svelte";
  import { selection } from "../selection/selection.svelte";
  import { formatKey } from "../commands/keys";
  import { getCommand, runCommand } from "../commands/registry.svelte";
  import { searchState } from "../search/search.svelte";
  import { teleportToObject } from "./navigate";
  import {
    canNavigateBack,
    canNavigateForward,
    navigationHistoryState,
  } from "./navigationHistory.svelte";
  import {
    closeObjectsPanel,
    objectsPanel,
    toggleObjectsPanel,
  } from "./panelState.svelte";
  import { closePanelPopup, panelPopupState } from "../ui/popups/panelPopupState.svelte";

  let { variant = "dock" } = $props<{ variant?: "dock" | "popup" }>();

  let toggleCommand = $derived(getCommand("ui.toggleObjectsPanel"));
  let backCommand = $derived(getCommand("navigation.back"));
  let forwardCommand = $derived(getCommand("navigation.forward"));
  let toggleKeys = $derived(toggleCommand?.keys.map(formatKey).join(", ") ?? "");
  let backKeys = $derived(backCommand?.keys.map(formatKey).join(", ") ?? "");
  let forwardKeys = $derived(forwardCommand?.keys.map(formatKey).join(", ") ?? "");
  let isOpen = $derived(variant === "popup" ? panelPopupState.active === "objects" : objectsPanel.open);
  let canGoBack = $derived.by(() => {
    navigationHistoryState.revision;
    return canNavigateBack();
  });
  let canGoForward = $derived.by(() => {
    navigationHistoryState.revision;
    return canNavigateForward();
  });
  let filterInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!isOpen) return;
    queueMicrotask(() => {
      if (isOpen) filterInput?.focus();
    });
  });

  let visibleNotes = $derived.by(() => {
    const query = objectsPanel.query.trim().toLocaleLowerCase();
    const pinnedSearchIds = objectsPanel.pinnedSearchIds;
    const notes = Object.values(board.notes).filter((note) => {
      if (pinnedSearchIds) return pinnedSearchIds.includes(note.id);
      return note.name.toLocaleLowerCase().includes(query);
    });
    if (objectsPanel.sort === "recent") {
      return notes.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.name.localeCompare(b.name));
    }
    return notes.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closeCurrentPanel();
  }

  function jumpToNote(id: string): void {
    if (!teleportToObject(id, { label: "Objects panel" })) return;
    if (!objectsPanel.pinned) closeCurrentPanel();
  }

  function closeCurrentPanel(): void {
    if (variant === "popup") closePanelPopup();
    else closeObjectsPanel();
  }

  function toggleSearchPin(): void {
    if (objectsPanel.pinned) {
      objectsPanel.pinnedSearchIds = null;
    } else if (searchState.query.trim()) {
      objectsPanel.query = searchState.query;
      const matchingIds = [...new Set(searchState.results.map((result) => result.noteId))];
      objectsPanel.pinnedSearchIds = matchingIds.length ? matchingIds : null;
    }
    objectsPanel.pinned = !objectsPanel.pinned;
  }
</script>

{#if isOpen}
  <dialog
    open
    id="objects-panel"
    class="objects-panel"
    class:popup-panel={variant === "popup"}
    data-selection-ignore
    aria-modal={variant === "popup"}
    aria-label="Objects panel"
    onkeydown={handleKeydown}
  >
    <header class="panel-heading">
      <div class="panel-title">
        <h2>Objects</h2>
        <span>{visibleNotes.length}</span>
      </div>
      <div class="panel-controls">
        <button
          type="button"
          class="panel-control"
          aria-label={`Navigate back${backKeys ? `; ${backKeys}` : ""}`}
          title={`Navigate back${backKeys ? ` · ${backKeys}` : ""}`}
          disabled={!canGoBack}
          onclick={() => runCommand("navigation.back")}
        >←</button>
        <button
          type="button"
          class="panel-control"
          aria-label={`Navigate forward${forwardKeys ? `; ${forwardKeys}` : ""}`}
          title={`Navigate forward${forwardKeys ? ` · ${forwardKeys}` : ""}`}
          disabled={!canGoForward}
          onclick={() => runCommand("navigation.forward")}
        >→</button>
        <button
          type="button"
          class="panel-control"
          class:pinned={objectsPanel.pinned}
          aria-label={objectsPanel.pinned ? "Unpin search" : "Pin search"}
          aria-pressed={objectsPanel.pinned}
          title={objectsPanel.pinned ? "Unpin search; close after jumping" : "Pin search; keep the panel open after jumping"}
          onclick={toggleSearchPin}
        >{objectsPanel.pinned ? "Pinned" : "Pin search"}</button>
        <button
          type="button"
          class="panel-control close"
          aria-label="Close objects panel"
          title="Close"
          onclick={closeCurrentPanel}
        >×</button>
      </div>
    </header>

    <div class="objects-tools">
      <label class="filter-label">
        <span class="visually-hidden">Filter objects by name</span>
        <input
          bind:this={filterInput}
          type="search"
          value={objectsPanel.query}
          placeholder="Filter notes…"
          aria-label="Filter objects by name"
          oninput={(event) => (objectsPanel.query = event.currentTarget.value)}
        />
      </label>
      <button
        class="sort-button"
        type="button"
        aria-label={objectsPanel.sort === "name" ? "Sort by creation time" : "Sort by name"}
        title={objectsPanel.sort === "name" ? "Sort by creation time" : "Sort by name"}
        onclick={() => (objectsPanel.sort = objectsPanel.sort === "name" ? "recent" : "name")}
      >{objectsPanel.sort === "name" ? "Name" : "Recent"}</button>
    </div>

    <ul class="object-list" aria-label="Notes">
      {#each visibleNotes as note (note.id)}
        <li>
          <button
            class="object-entry"
            class:selected={selection.ids.includes(note.id)}
            type="button"
            title={`Go to ${note.name} · ${note.x}, ${note.y}`}
            aria-current={selection.primaryId === note.id ? "true" : undefined}
            onclick={() => jumpToNote(note.id)}
          >
            <span class="object-dot" aria-hidden="true">●</span>
            <span class="object-name">{note.name}</span>
            <span class="object-position">{note.x}, {note.y}</span>
          </button>
        </li>
      {:else}
        <li class="empty-state">{objectsPanel.query ? "No notes match this filter." : "No notes in this project."}</li>
      {/each}
    </ul>
  </dialog>
{:else}
  <button
    class="objects-tab"
    data-selection-ignore
    type="button"
    aria-controls="objects-panel"
    aria-expanded={objectsPanel.open}
    aria-label={`Open objects panel${toggleKeys ? `; ${toggleKeys}` : ""}`}
    title={`Objects${toggleKeys ? ` · ${toggleKeys}` : ""}`}
    onclick={toggleObjectsPanel}
  >Objects</button>
{/if}

<style>
  .objects-panel,
  .objects-tab {
    position: absolute;
    z-index: 7;
    top: 48px;
    left: 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
    color: var(--text);
  }

  .objects-panel {
    margin: 0;
    display: flex;
    width: min(286px, calc(100% - 16px));
    max-width: none;
    max-height: min(480px, calc(100% - 56px));
    flex-direction: column;
    overflow: hidden;
    padding: 0;
  }

  .objects-tab {
    min-height: 28px;
    padding: 4px 8px;
    color: var(--text-dim);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .objects-tab:hover {
    border-color: rgba(var(--accent-rgb), 0.45);
    background: rgba(var(--accent-rgb), 0.16);
    color: var(--accent);
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

  .panel-title,
  .panel-controls,
  .objects-tools {
    display: flex;
    align-items: center;
  }

  .panel-title {
    min-width: 0;
    align-items: baseline;
    gap: 8px;
  }

  h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }

  .panel-title > span,
  .object-position {
    color: var(--text-dim);
    font-family: var(--mono-font);
    font-size: 9px;
    font-variant-numeric: tabular-nums;
  }

  .panel-controls {
    gap: 3px;
  }

  .panel-control,
  .sort-button {
    min-height: 24px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }

  .panel-control:hover,
  .sort-button:hover {
    border-color: #4a4a4a;
    background: var(--bg-hover);
    color: var(--text);
  }

  .panel-control.pinned {
    border-color: rgba(var(--accent-rgb), 0.45);
    background: rgba(var(--accent-rgb), 0.16);
    color: var(--accent);
  }

  .panel-control:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .panel-control.close {
    color: #aaa;
    font-size: 14px;
  }

  .objects-tools {
    gap: 4px;
    padding: 6px;
    border-bottom: 1px solid #343434;
  }

  .filter-label {
    flex: 1;
    min-width: 0;
  }

  .filter-label input {
    width: 100%;
    min-height: 25px;
    box-sizing: border-box;
    padding: 4px 6px;
    border: 1px solid #414141;
    border-radius: 2px;
    outline: none;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    font-size: 10px;
  }

  .filter-label input:focus {
    border-color: var(--accent);
  }

  .object-list {
    display: flex;
    min-height: 0;
    flex-direction: column;
    overflow: auto;
    margin: 0;
    padding: 3px;
    list-style: none;
  }

  .object-entry {
    display: flex;
    width: 100%;
    min-height: 27px;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 10px;
    text-align: left;
    cursor: pointer;
  }

  .object-entry:hover,
  .object-entry.selected {
    border-color: rgba(var(--accent-rgb), 0.45);
    background: rgba(var(--accent-rgb), 0.16);
  }

  .object-dot {
    color: var(--icon);
    font-size: 8px;
  }

  .object-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-state {
    padding: 10px 8px;
    color: var(--text-dim);
    font-size: 10px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
