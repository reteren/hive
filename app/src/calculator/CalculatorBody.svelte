<script lang="ts">
  import { isTextEditingTarget } from "../commands/focus";
  import type { Note } from "../model/note";
  import { calculatorData } from "./calculators.svelte";
  import { addCalculatorEntry, deleteCalculatorEntry, editCalculatorEntry } from "./calculatorActions.svelte";
  import { formatCalculatorResult, recomputeCalculatorEntries } from "./expression";
  import BankPanel from "./BankPanel.svelte";

  let { note }: { note: Note } = $props();
  let data = $derived(calculatorData(note.name));
  let entries = $derived(recomputeCalculatorEntries(data.entries));
  let newExpression = $state("");
  let editingId = $state<string | null>(null);
  let editExpression = $state("");

  function handleNewKeydown(event: KeyboardEvent): void {
    if (!isTextEditingTarget(event.target)) return;
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      if (addCalculatorEntry(note.name, newExpression)) newExpression = "";
    } else if (event.key === "Escape") {
      event.preventDefault();
      newExpression = "";
    }
  }

  function handleEditKeydown(event: KeyboardEvent, entryId: string): void {
    if (!isTextEditingTarget(event.target)) return;
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      editCalculatorEntry(note.name, entryId, editExpression);
      editingId = null;
    } else if (event.key === "Escape") {
      event.preventDefault();
      editingId = null;
    }
  }

  function startEdit(id: string, expression: string): void {
    editingId = id;
    editExpression = expression;
  }
</script>

<section class="calculator-body" aria-label="Calculator">
  <div class="calculator-entry-form">
    <input
      bind:value={newExpression}
      type="text"
      inputmode="decimal"
      aria-label="Expression"
      placeholder="Expression"
      onkeydown={handleNewKeydown}
    />
    <button type="button" onclick={() => {
      if (addCalculatorEntry(note.name, newExpression)) newExpression = "";
    }}>Add</button>
  </div>

  {#if entries.length > 0}
    <ol class="calculator-history" aria-label="Calculation history">
      {#each entries as entry (entry.id)}
        <li class="calculator-row" data-error={entry.error ? "true" : undefined}>
          {#if editingId === entry.id}
            <input
              bind:value={editExpression}
              class="calculator-edit"
              type="text"
              inputmode="decimal"
              aria-label="Edit expression"
              onkeydown={(event) => handleEditKeydown(event, entry.id)}
            />
          {:else}
            <button
              type="button"
              class="calculator-expression"
              aria-label={`Edit ${entry.expression}`}
              onclick={() => startEdit(entry.id, entry.expression)}
            >
              <span>{entry.expression}</span>
              <span class="calculator-result">{entry.value === null ? "—" : formatCalculatorResult(entry.value)}</span>
            </button>
          {/if}
          <button
            type="button"
            class="calculator-delete"
            aria-label={`Delete ${entry.expression}`}
            title="Delete entry"
            onclick={() => deleteCalculatorEntry(note.name, entry.id)}
          >×</button>
          {#if entry.error}
            <small class="calculator-error" role="status">{entry.error}</small>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  <BankPanel {note} {data} />
</section>

<style>
  .calculator-body {
    display: grid;
    min-width: 0;
    gap: 7px;
    color: var(--text);
    font-size: 11px;
  }

  .calculator-entry-form {
    display: flex;
    min-width: 0;
    gap: 5px;
  }

  .calculator-entry-form input,
  .calculator-edit {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 4px 6px;
    color: var(--text);
    background: #202020;
    border: 1px solid #4b4b4b;
    border-radius: 3px;
    font: inherit;
  }

  .calculator-entry-form input:focus,
  .calculator-edit:focus {
    border-color: var(--accent);
    outline: 1px solid var(--accent);
  }

  .calculator-entry-form button {
    flex: 0 0 auto;
    padding: 3px 8px;
    color: var(--text);
    background: #343434;
    border: 1px solid #4b4b4b;
    border-radius: 3px;
    font: inherit;
    cursor: pointer;
  }

  .calculator-entry-form button:hover,
  .calculator-delete:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .calculator-history {
    display: grid;
    max-height: 180px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .calculator-row {
    position: relative;
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
    padding: 3px 0;
    border-top: 1px solid #383838;
  }

  .calculator-expression {
    display: flex;
    min-width: 0;
    flex: 1;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 3px;
    color: var(--text-dim);
    background: transparent;
    border: 0;
    text-align: left;
    font: inherit;
    cursor: text;
  }

  .calculator-expression > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .calculator-result {
    flex: 0 0 auto;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .calculator-delete {
    flex: 0 0 auto;
    padding: 0 4px;
    color: var(--text-dim);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 2px;
    font: inherit;
    cursor: pointer;
  }

  .calculator-row[data-error="true"] .calculator-result {
    color: #e08c73;
  }

  .calculator-error {
    position: absolute;
    right: 22px;
    bottom: -2px;
    color: #e08c73;
    font-size: 9px;
    transform: translateY(100%);
  }

  .calculator-row[data-error="true"] {
    margin-bottom: 11px;
  }
</style>
