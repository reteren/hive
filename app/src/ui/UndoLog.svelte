<script lang="ts">
  import {
    closeUndoLog,
    history,
    jumpTo,
    redo,
    setHistoryLimit,
    toggleUndoLogPin,
    undo,
    undoLogPanel,
  } from "../history/history.svelte";
  import { formatKey } from "../commands/keys";
  import { getCommand } from "../commands/registry.svelte";

  let limitDraft = $state(String(history.limit));
  let undoCommand = $derived(getCommand("edit.undo"));
  let redoCommand = $derived(getCommand("edit.redo"));
  let undoBindings = $derived(undoCommand?.keys.map(formatKey).join(", ") ?? "");
  let redoBindings = $derived(redoCommand?.keys.map(formatKey).join(", ") ?? "");
  $effect(() => {
    limitDraft = String(history.limit);
  });

  function changeLimit(event: Event): void {
    const value = event.currentTarget;
    if (!(value instanceof HTMLInputElement)) return;
    setHistoryLimit(value.valueAsNumber);
    limitDraft = String(history.limit);
  }

  function handleLimitKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      (event.currentTarget as HTMLInputElement).blur();
    } else if (event.key === "Escape") {
      limitDraft = String(history.limit);
      (event.currentTarget as HTMLInputElement).blur();
    }
  }

  function moveTo(index: number): void {
    try {
      jumpTo(index);
      if (!undoLogPanel.pinned) closeUndoLog();
    } catch {
      // The history wrapper leaves its cursor at the last successful step and shows feedback.
    }
  }

  function runUndo(): void {
    try {
      undo();
    } catch {
      // The history wrapper shows a short failure caption.
    }
  }

  function runRedo(): void {
    try {
      redo();
    } catch {
      // The history wrapper shows a short failure caption.
    }
  }
</script>

<aside id="undo-log-panel" class="history-panel" aria-label="Undo history">
  <header class="panel-heading">
    <div class="panel-title">
      <h2>Undo log</h2>
      <span>{history.cursor}/{history.entries.length}</span>
    </div>
    <div class="panel-controls">
      <button
        class="panel-control"
        class:pinned={undoLogPanel.pinned}
        type="button"
        aria-label={undoLogPanel.pinned ? "Unpin undo log" : "Pin undo log"}
        aria-pressed={undoLogPanel.pinned}
        title={undoLogPanel.pinned ? "Unpin; close after choosing an entry" : "Pin; keep open after choosing an entry"}
        onclick={toggleUndoLogPin}
      >
        {undoLogPanel.pinned ? "Pinned" : "Pin"}
      </button>
      <button class="panel-control close" type="button" aria-label="Close undo log" title="Close" onclick={closeUndoLog}>
        ×
      </button>
    </div>
  </header>

  <p class="panel-hint">Choose a point in the command history.</p>

  <div class="history-actions" aria-label="Undo and redo">
    <button
      type="button"
      aria-label={`Undo${undoBindings ? `; ${undoBindings}` : ""}`}
      onclick={runUndo}
      title={`Undo${undoBindings ? ` · ${undoBindings}` : ""}`}
    >Undo {#if undoBindings}<kbd>{undoBindings}</kbd>{/if}</button>
    <button
      type="button"
      aria-label={`Redo${redoBindings ? `; ${redoBindings}` : ""}`}
      onclick={runRedo}
      title={`Redo${redoBindings ? ` · ${redoBindings}` : ""}`}
    >Redo {#if redoBindings}<kbd>{redoBindings}</kbd>{/if}</button>
  </div>

  <label class="limit-setting">
    <span>History limit</span>
    <input
      type="number"
      min="8"
      max="256"
      step="1"
      value={limitDraft}
      aria-label="History limit in steps, from 8 to 256"
      oninput={(event) => { limitDraft = event.currentTarget.value; }}
      onchange={changeLimit}
      onkeydown={handleLimitKeydown}
    />
    <span class="unit">steps</span>
  </label>

  <ol class="history-list" aria-label="Recorded operations">
    <li class="history-row start" class:current={history.cursor === 0}>
      <button
        type="button"
        class="history-entry"
        aria-current={history.cursor === 0 ? "step" : undefined}
        onclick={() => moveTo(0)}
      >
        <span class="entry-state">{history.cursor === 0 ? "Here" : "Start"}</span>
        <span class="entry-detail">
          <span class="entry-label">Initial state</span>
          <span class="entry-target">Board</span>
        </span>
      </button>
    </li>
    {#each history.entries as entry, index (index)}
      {@const isCurrent = history.cursor === index + 1}
      {@const isRedoable = index >= history.cursor}
      <li class="history-row" class:current={isCurrent} class:future={isRedoable}>
        <button
          type="button"
          class="history-entry"
          aria-current={isCurrent ? "step" : undefined}
          onclick={() => moveTo(index + 1)}
        >
          <span class="entry-state">{isCurrent ? "Here" : isRedoable ? "Redo" : ""}</span>
          <span class="entry-detail">
            <span class="entry-label">{entry.label}</span>
            <span class="entry-target">{entry.target?.trim() || "Board"}</span>
          </span>
        </button>
      </li>
    {:else}
      <li class="empty-state">No recorded operations yet.</li>
    {/each}
  </ol>
</aside>

<style>
  .history-panel {
    position: absolute;
    z-index: 7;
    top: 44px;
    right: 8px;
    display: flex;
    width: min(300px, calc(100% - 16px));
    max-height: min(480px, calc(100% - 54px));
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #080808;
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
    color: var(--text);
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

  .panel-title {
    display: flex;
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
  .entry-state,
  .entry-target,
  .unit {
    color: var(--text-dim);
    font-family: var(--mono-font);
    font-size: 9px;
    font-variant-numeric: tabular-nums;
  }

  .panel-controls {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .panel-control {
    min-height: 24px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .panel-control:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .panel-control.pinned {
    border-color: #806b2d;
    background: #413716;
    color: #fff0be;
  }

  .panel-control.close {
    width: 24px;
    padding: 0;
    font-size: 17px;
    line-height: 1;
  }

  .panel-hint {
    margin: 0;
    padding: 7px 10px 5px;
    color: var(--text-dim);
    font-size: 10px;
  }

  .history-actions {
    display: flex;
    gap: 5px;
    padding: 0 8px 7px;
  }

  .history-actions button {
    display: flex;
    min-height: 27px;
    flex: 1;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 3px 7px;
    border: 1px solid #414141;
    border-radius: 3px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .history-actions button:hover {
    border-color: #6d5a25;
    background: var(--bg-hover);
  }

  kbd {
    color: var(--text-dim);
    font-family: var(--mono-font);
    font-size: 9px;
  }

  .limit-setting {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px;
    border-block: 1px solid #393939;
    color: var(--text-dim);
    font-size: 10px;
  }

  .limit-setting input {
    width: 56px;
    height: 23px;
    margin-left: auto;
    padding: 2px 5px;
    border: 1px solid #484848;
    border-radius: 3px;
    background: #181818;
    color: var(--text);
    font: inherit;
    font-family: var(--mono-font);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .limit-setting input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .history-list {
    min-height: 0;
    margin: 0;
    padding: 4px;
    overflow: auto;
    list-style: none;
    scrollbar-color: #505050 #1b1b1b;
    scrollbar-width: thin;
  }

  .history-row {
    margin: 1px 0;
    border-left: 2px solid transparent;
    border-radius: 2px;
  }

  .history-row.current {
    border-left-color: var(--accent);
    background: #343019;
  }

  .history-row.future {
    opacity: 0.48;
  }

  .history-entry {
    display: flex;
    width: 100%;
    min-height: 31px;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .history-entry:hover {
    background: var(--bg-hover);
  }

  .history-row.current .entry-state {
    color: var(--accent);
  }

  .entry-state {
    width: 32px;
    flex: 0 0 32px;
    text-transform: uppercase;
  }

  .entry-detail {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 2px;
  }

  .entry-label,
  .entry-target {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-label {
    font-size: 11px;
  }

  .entry-target {
    font-size: 9px;
  }

  .empty-state {
    padding: 12px 8px;
    color: var(--text-dim);
    font-size: 10px;
    text-align: center;
  }
</style>
