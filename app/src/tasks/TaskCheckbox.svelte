<!-- Task completion checkbox in the note header (R3.1); renders nothing for non-task notes. -->
<script lang="ts">
  import type { Note } from "../model/note";
  import { toggleTaskCompletion } from "./taskActions.svelte";
  import { t } from "../i18n/i18n.svelte";

  let { note }: { note: Note } = $props();

  /** Only a click celebrates: notes remount while the board pans, and that must not replay it. */
  let celebrate = $state(false);
  let celebrateTimer: ReturnType<typeof setTimeout> | undefined;

  function toggle(): void {
    const completing = !note.task?.done;
    toggleTaskCompletion(note.id);
    clearTimeout(celebrateTimer);
    celebrate = completing;
    if (completing) celebrateTimer = setTimeout(() => { celebrate = false; }, 700);
  }

  $effect(() => () => clearTimeout(celebrateTimer));
</script>

{#if note.task}
  <span class="task-control" class:celebrate>
    <button
      class="task-checkbox"
      data-selection-ignore
      class:done={note.task.done}
      type="button"
      role="checkbox"
      aria-checked={note.task.done}
      aria-label={`${note.task.done ? t("Reopen") : t("Complete")} ${note.name}`}
      title={`${note.task.done ? t("Reopen") : t("Complete")} ${note.name}`}
      onclick={toggle}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.2" />
        {#if note.task.done}<path d="m4.7 8.1 2.1 2.1 4.5-4.6" />{/if}
      </svg>
    </button>
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

  /* Completing by click: the dot pops, the tick draws itself in, a ring ripples out once. */
  .celebrate circle {
    animation: task-pop 420ms cubic-bezier(0.34, 1.45, 0.64, 1);
    transform-box: fill-box;
    transform-origin: center;
  }

  .celebrate path {
    stroke-dasharray: 10;
    animation: task-tick 300ms cubic-bezier(0.16, 1, 0.3, 1) 90ms backwards;
  }

  .celebrate::after {
    position: absolute;
    inset: 1px;
    border: 1.5px solid #a3d5a8;
    border-radius: 50%;
    content: "";
    pointer-events: none;
    animation: task-ring 560ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes task-pop {
    0% { scale: 0.6; }
    100% { scale: 1; }
  }

  @keyframes task-tick {
    from { stroke-dashoffset: 10; }
    to { stroke-dashoffset: 0; }
  }

  @keyframes task-ring {
    from { opacity: 0.9; scale: 0.8; }
    to { opacity: 0; scale: 2.1; }
  }

  .task-checkbox:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

</style>
