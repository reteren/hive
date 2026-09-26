<script lang="ts">
  import { onMount, tick } from "svelte";
  import { board } from "../model/board.svelte";
  import type { CalculatorData } from "../model/nodeData";
  import type { Note } from "../model/note";
  import { bankTotals, formatBankNumber, parseBankAmount } from "./bank";
  import {
    addManualBankRow,
    bankFocus,
    commitBankInitial,
    commitBankName,
    commitBankRowAmount,
    commitBankRowLabel,
    createBank,
    deleteBankRow,
    previewBankInitial,
    previewBankName,
    previewBankRowAmount,
    previewBankRowLabel,
    removeBank,
    startBankLabelSync,
  } from "./bankActions.svelte";

  let { note, data }: { note: Note; data: CalculatorData } = $props();
  let root: HTMLElement;
  let createNameInput = $state<HTMLInputElement>();
  let creating = $state(false);
  let confirmingRemoval = $state(false);
  let createName = $state("");
  let createInitial = $state("0");
  let newLabel = $state("");
  let newAmount = $state("0");
  let error = $state("");
  let initialDraft = $state<string | null>(null);
  let amountDrafts = $state<Record<string, string>>({});
  let nameBefore = "";
  let initialBefore = 0;
  const rowBefore = new Map<string, { label: string; amount: number }>();
  const totals = $derived(bankTotals(data));

  onMount(startBankLabelSync);

  $effect(() => {
    const calculatorId = bankFocus.calculatorId;
    const rowId = bankFocus.rowId;
    if (calculatorId !== note.id || !rowId) return;
    void tick().then(() => {
      const amount = [...root.querySelectorAll<HTMLInputElement>("[data-bank-row-amount]")]
        .find((input) => input.dataset.bankRowAmount === rowId);
      amount?.focus();
      amount?.select();
      if (bankFocus.calculatorId === calculatorId && bankFocus.rowId === rowId) {
        bankFocus.calculatorId = null;
        bankFocus.rowId = null;
      }
    });
  });

  function openCreate(): void {
    createName = note.name;
    createInitial = "0";
    error = "";
    creating = true;
    void tick().then(() => createNameInput?.focus());
  }

  function submitCreate(event: SubmitEvent): void {
    event.preventDefault();
    const initial = parseBankAmount(createInitial);
    if (!createName.trim() || !createInitial.trim() || initial === null || !createBank(note.name, createName, initial)) {
      error = "Enter a bank name and a valid initial amount";
      return;
    }
    error = "";
    creating = false;
  }

  function submitRow(event: SubmitEvent): void {
    event.preventDefault();
    const amount = parseBankAmount(newAmount);
    if (!newLabel.trim() || amount === null || !addManualBankRow(note.name, newLabel, amount)) {
      error = "Enter a row label and a valid amount";
      return;
    }
    newLabel = "";
    newAmount = "0";
    error = "";
  }

  function editInitial(event: Event): void {
    initialDraft = (event.currentTarget as HTMLInputElement).value;
    const value = parseBankAmount(initialDraft);
    if (value !== null) { previewBankInitial(note.name, value); error = ""; }
    else error = "Enter a valid amount";
  }

  function finishInitial(event: FocusEvent): void {
    const input = event.currentTarget as HTMLInputElement;
    const value = parseBankAmount(input.value);
    if (value === null) {
      previewBankInitial(note.name, initialBefore);
      input.value = String(initialBefore);
      error = "";
      initialDraft = null;
      return;
    }
    commitBankInitial(note.name, initialBefore, value);
    input.value = String(value);
    initialDraft = null;
    error = "";
  }

  function editRowAmount(event: Event, rowId: string): void {
    amountDrafts[rowId] = (event.currentTarget as HTMLInputElement).value;
    const value = parseBankAmount(amountDrafts[rowId]);
    if (value !== null) { previewBankRowAmount(note.name, rowId, value); error = ""; }
    else error = "Enter a valid amount";
  }

  function finishRowAmount(event: FocusEvent, rowId: string): void {
    const input = event.currentTarget as HTMLInputElement;
    const before = rowBefore.get(rowId)?.amount ?? data.rows.find((row) => row.id === rowId)?.amount ?? 0;
    const value = parseBankAmount(input.value);
    if (value === null) {
      previewBankRowAmount(note.name, rowId, before);
      input.value = String(before);
      error = "";
    } else {
      commitBankRowAmount(note.name, rowId, before, value);
      input.value = String(value);
      error = "";
    }
    rowBefore.delete(rowId);
    delete amountDrafts[rowId];
  }

  function finishRowLabel(event: FocusEvent, rowId: string): void {
    const input = event.currentTarget as HTMLInputElement;
    const before = rowBefore.get(rowId)?.label ?? data.rows.find((row) => row.id === rowId)?.label ?? "";
    commitBankRowLabel(note.name, rowId, before, input.value);
    rowBefore.delete(rowId);
  }

  function finishFieldKey(event: KeyboardEvent, restore: () => void): void {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") restore();
    (event.currentTarget as HTMLInputElement).blur();
  }
</script>

<section class="bank-panel" aria-label="Bank" bind:this={root}>
  <div class="bank-heading"><strong>Bank</strong></div>
  {#if data.bank && totals}
    <div class="bank-title-row">
      <input
        class="bank-name"
        aria-label="Bank name"
        value={data.bank.name}
        onfocus={() => { nameBefore = data.bank?.name ?? ""; }}
        oninput={(event) => previewBankName(note.name, event.currentTarget.value)}
        onblur={(event) => commitBankName(note.name, nameBefore, event.currentTarget.value)}
        onkeydown={(event) => finishFieldKey(event, () => {
          previewBankName(note.name, nameBefore);
          event.currentTarget.value = nameBefore;
        })}
      />
      <button type="button" class="quiet" aria-label="Remove bank" onclick={() => {
        if (data.rows.length) confirmingRemoval = true;
        else removeBank(note.name);
      }}>Remove</button>
    </div>
    {#if confirmingRemoval}
      <div class="bank-confirm" role="alert">
        <span>Remove bank and {data.rows.length} {data.rows.length === 1 ? "row" : "rows"}?</span>
        <button type="button" onclick={() => { confirmingRemoval = false; }}>Cancel</button>
        <button type="button" class="danger" onclick={() => { removeBank(note.name); confirmingRemoval = false; }}>Remove</button>
      </div>
    {/if}
    <div class="bank-total">
      <span>Initial</span>
      <input
        aria-label="Initial amount"
        type="text"
        inputmode="decimal"
        value={initialDraft ?? String(data.bank.initial)}
        onfocus={() => { initialBefore = data.bank?.initial ?? 0; initialDraft = String(initialBefore); }}
        oninput={editInitial}
        onblur={finishInitial}
        onkeydown={(event) => finishFieldKey(event, () => {
          previewBankInitial(note.name, initialBefore);
          event.currentTarget.value = String(initialBefore);
          initialDraft = null;
        })}
      />
    </div>
    <div class="bank-rows" aria-label="Bank rows">
      {#each data.rows as row (row.id)}
        <div class="bank-row">
          {#if row.sourceNoteId}
            <div class="bank-linked-label" title={board.notes[row.sourceNoteId] ? `Linked to ${row.label}` : "Source deleted"}>
              <span>{row.label}</span>
              {#if !board.notes[row.sourceNoteId]}<small>source deleted</small>{/if}
            </div>
          {:else}
            <input
              class="bank-row-label"
              aria-label="Row label"
              value={row.label}
              onfocus={() => { rowBefore.set(row.id, { label: row.label, amount: row.amount }); }}
              oninput={(event) => previewBankRowLabel(note.name, row.id, event.currentTarget.value)}
              onblur={(event) => finishRowLabel(event, row.id)}
              onkeydown={(event) => finishFieldKey(event, () => {
                const before = rowBefore.get(row.id)?.label ?? row.label;
                previewBankRowLabel(note.name, row.id, before);
                event.currentTarget.value = before;
              })}
            />
          {/if}
          <input
            class="bank-row-amount"
            data-bank-row-amount={row.id}
            aria-label={`Amount for ${row.label}`}
            type="text"
            inputmode="decimal"
            value={amountDrafts[row.id] ?? String(row.amount)}
            onfocus={() => { rowBefore.set(row.id, { label: row.label, amount: row.amount }); amountDrafts[row.id] = String(row.amount); }}
            oninput={(event) => editRowAmount(event, row.id)}
            onblur={(event) => finishRowAmount(event, row.id)}
            onkeydown={(event) => finishFieldKey(event, () => {
              const before = rowBefore.get(row.id)?.amount ?? row.amount;
              previewBankRowAmount(note.name, row.id, before);
              event.currentTarget.value = String(before);
              delete amountDrafts[row.id];
            })}
          />
          <button type="button" class="quiet bank-row-delete" aria-label={`Delete row ${row.label}`} onclick={() => deleteBankRow(note.name, row.id)}>×</button>
        </div>
      {/each}
    </div>
    <form class="bank-add-row" onsubmit={submitRow}>
      <input aria-label="New row label" placeholder="New row" bind:value={newLabel} />
      <input aria-label="New row amount" class="new-amount" type="text" inputmode="decimal" bind:value={newAmount} />
      <button type="submit">Add</button>
    </form>
    <div class="bank-total bank-remaining" class:negative={totals.remaining < 0}>
      <span>Remaining</span>
      <output>{formatBankNumber(totals.remaining)}</output>
    </div>
  {:else if creating}
    <form class="bank-create" onsubmit={submitCreate}>
      <input aria-label="Bank name" placeholder="Bank name" bind:value={createName} bind:this={createNameInput} />
      <input aria-label="Initial amount" type="text" inputmode="decimal" bind:value={createInitial} />
      <div class="bank-actions">
        <button type="button" class="quiet" onclick={() => { creating = false; error = ""; }}>Cancel</button>
        <button type="submit">Create bank</button>
      </div>
    </form>
  {:else}
    <button type="button" class="bank-create-button" onclick={openCreate}>Create bank</button>
    {#if data.rows.length}<small class="bank-pending">{data.rows.length} linked {data.rows.length === 1 ? "row" : "rows"} ready</small>{/if}
  {/if}
  {#if error}<p class="bank-error" role="status">{error}</p>{/if}
</section>

<style>
  .bank-panel { display: grid; gap: 6px; margin-top: 8px; padding-top: 7px; border-top: 1px solid #48443a; font-size: 11px; }
  .bank-heading { color: var(--accent); font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
  .bank-title-row, .bank-total, .bank-row, .bank-add-row, .bank-actions { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .bank-title-row .bank-name, .bank-row-label, .bank-add-row input:first-child { flex: 1 1 auto; min-width: 0; }
  .bank-panel input { min-width: 0; height: 24px; padding: 3px 5px; border: 1px solid #555; border-radius: 3px; color: var(--text); background: #202020; font: inherit; }
  .bank-panel input:focus { border-color: var(--accent); outline: none; }
  .bank-panel button { min-height: 23px; padding: 3px 6px; border: 1px solid #625633; border-radius: 3px; background: #383324; color: #f0d8a1; cursor: pointer; white-space: nowrap; }
  .bank-panel button:hover { background: #4b4026; }
  .bank-panel .quiet { border-color: transparent; background: transparent; color: var(--text-dim); }
  .bank-panel .quiet:hover { color: var(--text); background: #363636; }
  .bank-panel .danger { border-color: #87554f; color: #f1bbb2; background: #4b302d; }
  .bank-total { justify-content: space-between; }
  .bank-total input, .bank-row-amount, .bank-add-row .new-amount { width: 86px; flex: 0 0 86px; text-align: right; font-family: var(--mono-font); }
  .bank-rows { display: grid; gap: 3px; }
  .bank-linked-label { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; overflow: hidden; }
  .bank-linked-label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bank-linked-label small, .bank-pending { color: var(--text-dim); font-size: 10px; }
  .bank-row-delete { width: 23px; flex: 0 0 23px; font-size: 15px; line-height: 1; }
  .bank-remaining { padding-top: 5px; border-top: 1px solid #464646; font-weight: 650; }
  .bank-remaining output { font-family: var(--mono-font); color: #dfc782; }
  .bank-remaining.negative output { color: #ec8c81; }
  .bank-create { display: grid; gap: 5px; }
  .bank-actions { justify-content: flex-end; }
  .bank-confirm { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; padding: 6px; border: 1px solid #735142; border-radius: 3px; background: #342a26; }
  .bank-confirm span { flex: 1 1 100%; }
  .bank-error { margin: 0; color: #ec8c81; font-size: 10px; }
</style>
