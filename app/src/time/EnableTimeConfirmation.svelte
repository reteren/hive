<script lang="ts">
  import { onMount } from "svelte";
  let { onanswer }: { onanswer: (enable: boolean, remember: boolean) => void } = $props();
  let dialog: HTMLDialogElement;
  let noButton: HTMLButtonElement;
  let remember = $state(false);
  onMount(() => { dialog.showModal(); noButton.focus(); return () => dialog.close(); });
  function answer(enable: boolean, save = true): void { onanswer(enable, save && remember); }
</script>

<dialog bind:this={dialog} data-time-enable-confirmation data-selection-ignore
  aria-label="Enable timer" aria-describedby="time-enable-explanation"
  oncancel={(event) => { event.preventDefault(); answer(false, false); }}
  onkeydown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); answer(false, false); } }}>
  <h2>Enable timer?</h2>
  <p id="time-enable-explanation">Are you sure you want to enable the timer? All linked tasks are already done.</p>
  <label><input type="checkbox" data-time-confirm-remember bind:checked={remember} /> <span>Don't show this again</span></label>
  <footer>
    <button bind:this={noButton} type="button" data-time-confirm-no onclick={() => answer(false)}>No</button>
    <button type="button" class="yes" data-time-confirm-yes onclick={() => answer(true)}>Yes</button>
  </footer>
</dialog>

<style>
  dialog { width: min(360px, calc(100vw - 32px)); margin: auto; padding: 16px; border: 1px solid var(--border); border-radius: 4px; color: var(--text); background: var(--bg-panel); font: 12px/1.5 var(--ui-font, "Segoe UI", sans-serif); user-select: none; }
  dialog::backdrop { background: rgb(0 0 0 / 40%); }
  h2 { margin: 0 0 8px; font-size: 14px; }
  p { margin: 0 0 14px; overflow-wrap: anywhere; }
  label { display: flex; align-items: center; gap: 6px; color: #bbb; }
  input { accent-color: var(--accent); }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  button { min-width: 58px; padding: 5px 12px; color: var(--text); background: var(--bg-panel-raised); border: 1px solid var(--border); border-radius: 3px; font: inherit; cursor: pointer; }
  button:hover { background: var(--bg-hover); }
  .yes { border-color: #947837; }
  :is(button, input):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
