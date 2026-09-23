<script lang="ts">
  import { board } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import {
    canCompleteTask,
    dependencyCyclePredecessors,
    dependencyWarnings,
  } from "./dependencies";
  import "./dependencies.css";

  let { note }: { note: Note } = $props();

  const blockers = $derived(canCompleteTask(note.id).blockers);
  const warnings = $derived(dependencyWarnings(note.id));
  const cycles = $derived(dependencyCyclePredecessors(note.id));
  const state = $derived(note.task?.done
    ? warnings.length > 0 ? "stale" : ""
    : blockers.length > 0 ? "blocked" : "");

  const tooltip = $derived.by(() => {
    if (state === "blocked") {
      const names = blockers.map((id) => board.notes[id]?.name ?? "Unknown task");
      const text = `Waiting for: ${names.join(", ")}.`;
      return cycles.length > 0
        ? `${text} These dependencies form a cycle; remove one of the lines to resolve it.`
        : text;
    }
    if (state === "stale") {
      const names = warnings.map((id) => board.notes[id]?.name ?? "Unknown task");
      const text = `Completed predecessor reopened: ${names.join(", ")}. This task remains done.`;
      return cycles.length > 0
        ? `${text} These dependencies form a cycle; remove one of the lines to resolve it.`
        : text;
    }
    return "";
  });
</script>

{#if state === "blocked"}
  <span
    class="dependencyBadge dependencyBadge--blocked"
    role="img"
    aria-label={tooltip}
    title={tooltip}
    data-selection-ignore
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="7" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      <path d="M8 9.5v2" />
    </svg>
  </span>
{:else if state === "stale"}
  <span
    class="dependencyBadge dependencyBadge--stale"
    role="img"
    aria-label={tooltip}
    title={tooltip}
    data-selection-ignore
  >
    !
  </span>
{/if}
