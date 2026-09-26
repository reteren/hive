<script lang="ts">
  import { execute } from "../history/history.svelte";
  import { updateNote } from "../model/board.svelte";
  import type { NodeScope } from "../model/nodeData";
  import type { Note } from "../model/note";
  import { createScopeChangeCommand } from "./scopeChange";
  import { scopeExists, scopeForNote, scopeOptions } from "./scope.svelte";
  import { scopeKey } from "./scopeLogic";

  let { note }: { note: Note } = $props();
  let selectedScope = $derived(scopeForNote(note));
  let selectedKey = $derived(scopeKey(selectedScope));
  let missing = $derived(!scopeExists(selectedScope));
  let options = $derived(scopeOptions());

  function changeScope(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    const option = options.find((candidate) => scopeKey(candidate.scope) === value);
    if (!option) return;

    const command = createScopeChangeCommand(note, option.scope, (noteId, scope) => {
      updateNote(noteId, { scope });
    });
    if (command) execute(command);
  }
</script>

<div class="scope-picker" data-selection-ignore>
  <label for={`scope-${note.id}`}>Scope</label>
  <select
    id={`scope-${note.id}`}
    value={selectedKey}
    aria-label={`Scope for ${note.name}`}
    onchange={changeScope}
    ondblclick={(event) => event.stopPropagation()}
  >
    {#if missing}
      <option value={selectedKey} disabled>Scope missing</option>
    {/if}
    {#each options as option (`${option.scope.kind}:${option.scope.kind === "board" ? "board" : option.scope.id}`)}
      <option value={scopeKey(option.scope)}>{option.label}</option>
    {/each}
  </select>
</div>

<style>
  .scope-picker {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 7px;
    color: var(--text-dim);
    font-size: 10px;
  }

  select {
    min-width: 0;
    flex: 1;
    padding: 3px 20px 3px 6px;
    color: var(--text);
    background: #202020;
    border: 1px solid #4a4a4a;
    border-radius: 3px;
    font: inherit;
  }
</style>
