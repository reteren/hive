<!-- Task completion checkbox in the note header (R3.1); renders nothing for non-task notes. -->
<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Note } from "../model/note";
  import DependencyBadge from "./DependencyBadge.svelte";
  import { toggleTaskCompletion } from "./taskActions.svelte";

  let { note }: { note: Note } = $props();
  let blockedReason = $state("");
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;

  function toggle(): void {
    const result = toggleTaskCompletion(note.id);
    blockedReason = result.reason ?? "";
    if (dismissTimer !== undefined) clearTimeout(dismissTimer);
    if (blockedReason) {
      dismissTimer = setTimeout(() => {
        blockedReason = "";
        dismissTimer = undefined;
      }, 3_500);
    }
  }

  onDestroy(() => {
    if (dismissTimer !== undefined) clearTimeout(dismissTimer);
  });
</script>

{#if note.task}
  <span class="task-control">
    <button
      class="task-checkbox"
      data-selection-ignore
      class:done={note.task.done}
      type="button"
      role="checkbox"
      aria-checked={note.task.done}
      aria-label={`${note.task.done ? "Reopen" : "Complete"} ${note.name}`}
      aria-describedby={blockedReason ? `${note.id}-task-blocked` : undefined}
      title={blockedReason || `${note.task.done ? "Reopen" : "Complete"} ${note.name}`}
      onclick={toggle}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.2" />
        {#if note.task.done}<path d="m4.7 8.1 2.1 2.1 4.5-4.6" />{/if}
      </svg>
    </button>
    <DependencyBadge {note} />
    {#if blockedReason}
      <span id={`${note.id}-task-blocked`} class="task-blocked" role="status">{blockedReason}</span>
    {/if}
  </span>
{/if}

<style>
  .task-control {
    position: relative;
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
  }

  .task-checkbox {
    display: grid;
    width: 17px;
    height: 17px;
    flex: 0 0 auto;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #dedede;
    cursor: pointer;
  }

  .task-checkbox svg {
    display: block;
    width: 15px;
    height: 15px;
    overflow: visible;
  }

  .task-checkbox circle {
    fill: transparent;
    stroke: #999;
    stroke-width: 1.35;
  }

  .task-checkbox path {
    fill: none;
    stroke: #171717;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .task-checkbox.done circle {
    fill: #82bd88;
    stroke: #a3d5a8;
  }

  .task-checkbox:hover circle {
    stroke: #c1c1c1;
  }

  .task-checkbox:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .task-blocked {
    position: absolute;
    z-index: 20;
    top: calc(100% + 3px);
    left: 0;
    width: max-content;
    max-width: min(240px, calc(100vw - 24px));
    padding: 5px 7px;
    border: 1px solid #715348;
    border-radius: 3px;
    background: #322622;
    color: #f0c4b0;
    font-size: 10px;
    font-weight: 400;
    line-height: 1.35;
    overflow-wrap: anywhere;
    white-space: normal;
    user-select: text;
    pointer-events: none;
  }
</style>
