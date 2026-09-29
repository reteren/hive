<script lang="ts">
  import { execute } from "../history/history.svelte";
  import { updateNote } from "../model/board.svelte";
  import type { NodeScope } from "../model/nodeData";
  import type { Note } from "../model/note";
  import Select from "../ui/Select.svelte";
  import { createScopeChangeCommand } from "./scopeChange";
  import { linkedBeaconForNote, scopeChoiceForNote, scopeExists, scopeOptions } from "./scope.svelte";
  import { scopeKey } from "./scopeLogic";

  let { note }: { note: Note } = $props();
  let linkedBeacon = $derived(linkedBeaconForNote(note.id));
  let selectedScope = $derived(linkedBeacon?.scope ?? scopeChoiceForNote(note));
  let selectedKey = $derived(scopeKey(selectedScope));
  let missing = $derived(!scopeExists(selectedScope));
  let options = $derived(scopeOptions());

  function changeScope(value: string): void {
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
  <span class="scope-select">
    <Select
      id={`scope-${note.id}`}
      value={selectedKey}
      ariaLabel={`Scope for ${note.name}`}
      options={[
        ...(missing ? [{ value: selectedKey, label: "Scope missing", disabled: true }] : []),
        ...options.map((option) => ({ value: scopeKey(option.scope), label: option.label })),
      ]}
      onchange={changeScope}
      disabled={Boolean(linkedBeacon)}
      title={linkedBeacon ? "Linked to beacon — remove the link to change" : undefined}
      ondblclick={(event) => event.stopPropagation()}
    />
  </span>
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

  .scope-select {
    display: block;
    flex: 1;
    min-width: 0;
  }
</style>
