<script lang="ts">
  import type { CustomMark } from "../model/nodeData";
  import { MARKAS_PALETTE } from "./markasLogic";
  import { removeMarkAsTag, saveMarkAsTag, setCustomMarkFrame } from "./markasActions.svelte";

  let { note }: { note: { id: string; type: string; customMarks?: CustomMark[]; customMarkFrame?: boolean } } = $props();
  let marks = $derived(note.customMarks ?? []);
  let editingId = $state<string | null>(null);
  let draftText = $state("");
  let draftColor = $state<string>(MARKAS_PALETTE[0]);
  let error = $state("");

  function startAdd(): void {
    editingId = "";
    draftText = "";
    draftColor = MARKAS_PALETTE[0];
    error = "";
  }

  function startEdit(mark: CustomMark): void {
    editingId = mark.id;
    draftText = mark.text;
    draftColor = mark.color;
    error = "";
  }

  function cancelEdit(): void {
    editingId = null;
    error = "";
  }

  function save(event: SubmitEvent): void {
    event.preventDefault();
    if (editingId === null) return;
    const result = saveMarkAsTag(note.id, editingId || null, draftText, draftColor);
    if (!result.ok) {
      error = result.error;
      return;
    }
    editingId = null;
    error = "";
  }

  function setColorFromPicker(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value;
    draftColor = value;
  }
</script>

<div class="markas-node" data-selection-ignore>
  <div class="markas-tags">
    {#each marks as mark (mark.id)}
      <div class="markas-tag-row">
        <button
          type="button"
          class="markas-tag"
          style={`--markas-tag-color: ${mark.color}`}
          aria-label={`Edit tag ${mark.text}`}
          onclick={() => startEdit(mark)}
        >
          <span class="markas-tag-dot" aria-hidden="true"></span>
          <span>{mark.text}</span>
        </button>
        <button
          type="button"
          class="markas-tag-remove"
          aria-label={`Delete tag ${mark.text}`}
          title="Delete tag"
          onclick={() => removeMarkAsTag(note.id, mark.id)}
        >×</button>
      </div>
    {/each}
    {#if marks.length === 0 && editingId === null}
      <span class="markas-empty">No tags yet</span>
    {/if}
    <button type="button" class="markas-add" data-module-trigger aria-label="Add tag" title="Add tag" onclick={startAdd}>+</button>
  </div>

  {#if editingId !== null}
    <form class="markas-editor" onsubmit={save}>
      <label class="markas-name-field">
        <span>Tag</span>
        <input bind:value={draftText} maxlength="30" aria-label="Tag name" autocomplete="off" />
      </label>
      <label class="markas-color-field">
        <span>Colour</span>
        <input
          class="markas-color-picker"
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(draftColor) ? draftColor : MARKAS_PALETTE[0]}
          aria-label="Choose tag colour"
          oninput={setColorFromPicker}
        />
        <input class="markas-hex" bind:value={draftColor} maxlength="7" aria-label="Tag hex colour" spellcheck="false" />
      </label>
      <div class="markas-palette" aria-label="Colour palette">
        {#each MARKAS_PALETTE as color (color)}
          <button
            type="button"
            class="markas-swatch"
            class:selected={draftColor.toLowerCase() === color}
            style={`--markas-tag-color: ${color}`}
            aria-label={`Use colour ${color}`}
            aria-pressed={draftColor.toLowerCase() === color}
            onclick={() => { draftColor = color; }}
          ></button>
        {/each}
      </div>
      {#if error}<span class="markas-error" role="alert">{error}</span>{/if}
      <div class="markas-editor-actions">
        <button type="button" onclick={cancelEdit}>Cancel</button>
        <button type="submit">Save</button>
      </div>
    </form>
  {/if}

  <label class="markas-frame-toggle">
    <input
      type="checkbox"
      checked={note.customMarkFrame === true}
      disabled={marks.length === 0}
      onchange={(event) => setCustomMarkFrame(note.id, event.currentTarget.checked)}
    />
    <span>Frame</span>
  </label>
</div>

<style>
  .markas-node {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
    color: #d8d8d8;
    font-size: 10px;
  }

  .markas-tags,
  .markas-tag-row,
  .markas-editor-actions,
  .markas-frame-toggle,
  .markas-color-field,
  .markas-palette {
    display: flex;
    align-items: center;
  }

  .markas-tags {
    width: 100%;
    flex-wrap: wrap;
    gap: 4px;
  }

  .markas-tag-row {
    gap: 2px;
  }

  .markas-tag,
  .markas-tag-remove,
  .markas-add,
  .markas-editor-actions button {
    min-height: 20px;
    border: 1px solid #484848;
    border-radius: 3px;
    background: #292929;
    color: #dedede;
    font: inherit;
    cursor: pointer;
  }

  .markas-tag {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
    padding: 2px 5px;
    border-color: color-mix(in srgb, var(--markas-tag-color) 48%, #454545);
    background: color-mix(in srgb, var(--markas-tag-color) 12%, #292929);
    color: var(--markas-tag-color);
    white-space: normal;
    text-align: left;
  }

  .markas-tag > span:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .markas-tag-dot,
  .markas-swatch {
    width: 9px;
    height: 9px;
    flex: 0 0 auto;
    border: 1px solid color-mix(in srgb, var(--markas-tag-color) 75%, #fff);
    border-radius: 50%;
    background: var(--markas-tag-color);
  }

  .markas-tag-remove {
    width: 18px;
    min-height: 20px;
    padding: 0;
    color: #cf9994;
  }

  .markas-add {
    width: 20px;
    padding: 0;
    border-radius: 50%;
    font-size: 14px;
    line-height: 1;
  }

  .markas-tag:hover,
  .markas-tag-remove:hover,
  .markas-add:hover,
  .markas-editor-actions button:hover {
    border-color: var(--accent);
    color: #fff;
  }

  .markas-tag:focus-visible,
  .markas-tag-remove:focus-visible,
  .markas-add:focus-visible,
  .markas-editor input:focus-visible,
  .markas-editor-actions button:focus-visible,
  .markas-frame-toggle input:focus-visible {
    outline: 2px solid #91afd2;
    outline-offset: 1px;
  }

  .markas-empty {
    color: #929292;
    font-size: 9px;
  }

  .markas-editor {
    display: grid;
    width: 100%;
    gap: 5px;
    padding: 6px;
    border: 1px solid #484848;
    border-radius: 3px;
    background: #222;
  }

  .markas-name-field,
  .markas-color-field {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 5px;
  }

  .markas-color-field {
    flex-wrap: wrap;
  }

  .markas-name-field span,
  .markas-color-field > span {
    width: 34px;
    flex: 0 0 auto;
    color: #a9a9a9;
  }

  .markas-editor input:not([type="color"]) {
    min-width: 0;
    flex: 1;
    padding: 3px 4px;
    border: 1px solid #454545;
    border-radius: 2px;
    background: #181818;
    color: #eee;
    font: inherit;
  }

  .markas-color-picker {
    width: 25px;
    height: 21px;
    padding: 1px;
    border: 1px solid #555;
    border-radius: 2px;
    background: #222;
    cursor: pointer;
  }

  .markas-hex {
    width: 62px;
    flex: 1 1 62px !important;
    text-transform: uppercase;
  }

  .markas-palette {
    gap: 5px;
    padding-left: 39px;
  }

  .markas-swatch {
    padding: 0;
    cursor: pointer;
  }

  .markas-swatch.selected {
    outline: 2px solid #eee;
    outline-offset: 1px;
  }

  .markas-error {
    color: #e6a29d;
    line-height: 1.3;
  }

  .markas-editor-actions {
    justify-content: flex-end;
    gap: 4px;
  }

  .markas-editor-actions button {
    min-height: 21px;
    padding: 2px 6px;
  }

  .markas-frame-toggle {
    gap: 4px;
    color: #bbb;
    cursor: pointer;
  }

  .markas-frame-toggle input {
    margin: 0;
    accent-color: #b59bd2;
  }
</style>
