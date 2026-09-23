<script lang="ts">
  import { board } from "../model/board.svelte";
  import { taskLog } from "./taskLog.svelte";
  import { openTasks, taskHistory } from "./taskTransitions";
  import { tasksPanel } from "./tasksPanelState.svelte";
  import { getCommand, runCommand } from "../commands/registry.svelte";
  import { formatKey } from "../commands/keys";
  import { teleportToObject } from "../navigation/navigate";
  import TaskCheckbox from "./TaskCheckbox.svelte";

  let openItems = $derived.by(() => openTasks(Object.values(board.notes)));
  let historyItems = $derived.by(() => taskHistory(taskLog.entries));
  let toggleCommand = $derived(getCommand("ui.toggleTasks"));
  let toggleKeys = $derived(toggleCommand?.keys.map(formatKey).join(", ") ?? "");

  function jumpToTask(noteId: string): void {
    teleportToObject(noteId, { label: "Tasks panel" });
  }

  function formatTime(value: number): string {
    return new Date(value).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    runCommand("ui.toggleTasks");
  }
</script>

{#if tasksPanel.open}
  <dialog
    open
    id="tasks-panel"
    class="tasks-panel"
    data-selection-ignore
    aria-label="Tasks"
    aria-modal="false"
    onkeydown={handleKeydown}
  >
    <header class="panel-heading">
      <div class="panel-title">
        <h2>Tasks</h2>
        <span>{openItems.length}</span>
      </div>
      <button
        class="panel-control close"
        type="button"
        aria-label="Close tasks panel"
        title={`Close${toggleKeys ? ` · ${toggleKeys}` : ""}`}
        onclick={() => runCommand("ui.toggleTasks")}
      >×</button>
    </header>

    <div class="panel-content">
      <ul class="task-list" aria-label="Open tasks">
        {#each openItems as note (note.id)}
          <li class="task-row">
            <TaskCheckbox {note} />
            <button
              class="task-name"
              type="button"
              title={`Go to ${note.name}`}
              onclick={() => jumpToTask(note.id)}
            >{note.name}</button>
          </li>
        {:else}
          <li class="empty-state">No open tasks.</li>
        {/each}
      </ul>

      {#if tasksPanel.historyOpen}
        <section class="task-history" aria-label="Completed task history">
          {#each historyItems as entry, index (`${entry.noteId}:${entry.doneAt}:${index}`)}
            {@const currentNote = board.notes[entry.noteId]}
            <div class="history-row">
              {#if currentNote}
                <button class="history-name" type="button" title={`Go to ${currentNote.name}`} onclick={() => jumpToTask(entry.noteId)}>
                  {entry.name}
                </button>
              {:else}
                <span class="history-name deleted">{entry.name} <span>(deleted)</span></span>
              {/if}
              <time datetime={new Date(entry.doneAt).toISOString()}>{formatTime(entry.doneAt)}</time>
            </div>
          {:else}
            <p class="empty-state">No completed tasks yet.</p>
          {/each}
        </section>
      {/if}
    </div>

    <footer class="panel-footer">
      <button
        class="history-toggle"
        type="button"
        aria-expanded={tasksPanel.historyOpen}
        onclick={() => (tasksPanel.historyOpen = !tasksPanel.historyOpen)}
      >{tasksPanel.historyOpen ? "Hide history" : "History"}</button>
    </footer>
  </dialog>
{:else}
  <button
    class="tasks-tab"
    data-selection-ignore
    type="button"
    aria-controls="tasks-panel"
    aria-expanded={tasksPanel.open}
    aria-label={`Open tasks panel${toggleKeys ? `; ${toggleKeys}` : ""}`}
    title={`Tasks${toggleKeys ? ` · ${toggleKeys}` : ""}`}
    onclick={() => runCommand("ui.toggleTasks")}
  >Tasks</button>
{/if}

<style>
  .tasks-panel,
  .tasks-tab {
    position: absolute;
    z-index: 7;
    top: 8px;
    right: 8px;
    border: 1px solid #080808;
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
    color: var(--text);
  }

  .tasks-panel {
    display: flex;
    left: auto;
    margin: 0;
    width: min(286px, calc(100% - 16px));
    max-width: none;
    max-height: calc(100% - 16px);
    flex-direction: column;
    overflow: hidden;
    padding: 0;
    pointer-events: auto;
  }

  .tasks-tab {
    min-height: 28px;
    padding: 4px 8px;
    color: var(--text-dim);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
    pointer-events: auto;
  }

  .tasks-tab:hover,
  .tasks-tab:focus-visible {
    border-color: #806b2d;
    background: #343019;
    color: #fff0be;
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

  .panel-title h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }

  .panel-title span {
    color: var(--text-dim);
    font-family: var(--mono-font);
    font-size: 9px;
    font-variant-numeric: tabular-nums;
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

  .panel-content {
    min-height: 0;
    overflow: auto;
    padding: 3px;
  }

  .task-list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .task-row {
    display: flex;
    min-height: 29px;
    align-items: center;
    gap: 5px;
    padding: 2px 4px;
  }

  .task-name,
  .history-name {
    min-width: 0;
    overflow: hidden;
    padding: 4px 5px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 10px;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .task-name {
    flex: 1;
  }

  .task-name:hover,
  .history-name:hover,
  .task-name:focus-visible,
  .history-name:focus-visible {
    border-color: #514322;
    background: #343019;
  }

  .empty-state {
    margin: 0;
    padding: 10px 8px;
    color: var(--text-dim);
    font-size: 10px;
  }

  .task-history {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid #343434;
  }

  .history-row {
    display: flex;
    min-height: 28px;
    align-items: center;
    gap: 4px;
  }

  .history-name {
    flex: 1;
  }

  .history-name.deleted {
    color: var(--text-dim);
    cursor: default;
  }

  .history-name.deleted span,
  .history-row time {
    color: var(--text-dim);
    font-size: 9px;
  }

  .history-row time {
    flex: 0 0 auto;
    padding-right: 4px;
    font-variant-numeric: tabular-nums;
  }

  .panel-footer {
    display: flex;
    justify-content: flex-end;
    padding: 4px;
    border-top: 1px solid #343434;
  }

  .history-toggle {
    min-height: 24px;
    padding: 3px 7px;
    border: 1px solid #414141;
    border-radius: 2px;
    background: #252525;
    color: var(--text-dim);
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }

  .history-toggle:hover,
  .history-toggle:focus-visible {
    border-color: var(--accent);
    color: var(--text);
  }
</style>
