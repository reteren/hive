<script lang="ts">
  import type { CustomMark } from "../model/nodeData";
  import { MARKAS_PALETTE } from "./markasLogic";
  import { removeMarkAsTag, saveMarkAsTag, setCustomMarkFrame } from "./markasActions.svelte";
  import { isMarkAsEditorCollapsed, toggleMarkAsEditor } from "./markasUi.svelte";

  let { note }: { note: { id: string; type: string; customMarks?: CustomMark[]; customMarkFrame?: boolean } } = $props();
  let marks = $derived(note.customMarks ?? []);
  let collapsed = $derived(isMarkAsEditorCollapsed(note.id));
  /** Id of the tag loaded into the editor for changing; null = the editor adds a new tag. */
  let editingId = $state<string | null>(null);
  let draftText = $state("");
  let draftColor = $state<string>(MARKAS_PALETTE[0]);
  let error = $state("");
  let textInput = $state<HTMLInputElement | null>(null);

  const HEX = /^#[0-9a-f]{6}$/i;

  function resetDraft(): void {
    editingId = null;
    draftText = "";
    error = "";
  }

  function editMark(mark: CustomMark): void {
    if (collapsed) toggleMarkAsEditor(note.id);
    editingId = mark.id;
    draftText = mark.text;
    draftColor = mark.color;
    error = "";
  }

  function submit(event?: Event): void {
    event?.preventDefault();
    const result = saveMarkAsTag(note.id, editingId, draftText, draftColor);
    if (!result.ok) {
      error = result.error;
      return;
    }
    resetDraft();
  }

  /** The + is always visible: with a filled tag it adds it, otherwise it opens the editor and focuses the tag field. */
  function addFromHeader(): void {
    if (!collapsed && draftText.trim()) {
      submit();
      return;
    }
    if (collapsed) toggleMarkAsEditor(note.id);
    queueMicrotask(() => textInput?.focus());
  }

  function removeMark(mark: CustomMark): void {
    if (editingId === mark.id) resetDraft();
    removeMarkAsTag(note.id, mark.id);
  }
</script>

<div class="markas-node" data-selection-ignore>
  <div class="markas-head">
    <ul class="markas-tags" aria-label="Tags">
      {#each marks as mark (mark.id)}
        <li class="markas-tag" class:editing={editingId === mark.id} style:--tag-color={mark.color}>
          <button type="button" class="markas-tag-label" title="Edit tag" onclick={() => editMark(mark)}>
            <span class="markas-dot" aria-hidden="true"></span>
            <span class="markas-tag-text">{mark.text}</span>
          </button>
          <button type="button" class="markas-tag-remove" aria-label={`Delete tag ${mark.text}`} title="Delete tag" onclick={() => removeMark(mark)}>
            <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" /></svg>
          </button>
        </li>
      {/each}
    </ul>
    <button type="button" class="markas-add" data-markas-add title={editingId ? "Save tag" : "Add tag"} aria-label={editingId ? "Save tag" : "Add tag"} onpointerdown={(event) => event.preventDefault()} onclick={addFromHeader}>
      {#if editingId}
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.3l2.3 2.3 4.7-5" /></svg>
      {:else}
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v7M2.5 6h7" /></svg>
      {/if}
    </button>
  </div>

  <button
    type="button"
    class="markas-collapse"
    class:collapsed
    aria-expanded={!collapsed}
    title={collapsed ? "Show tag editor" : "Hide tag editor"}
    data-markas-collapse
    onclick={() => toggleMarkAsEditor(note.id)}
  >
    <span class="markas-collapse-line" aria-hidden="true"></span>
  </button>

  {#if !collapsed}
    <form class="markas-editor" onsubmit={submit} data-markas-editor>
      <label class="markas-field">
        <span class="markas-field-name">Tag</span>
        <input
          class="markas-text"
          bind:this={textInput}
          bind:value={draftText}
          maxlength="30"
          placeholder={editingId ? "Edit tag" : "New tag"}
          aria-label="Tag name"
          autocomplete="off"
          spellcheck="false"
          data-markas-text
        />
      </label>

      <div class="markas-field">
        <span class="markas-field-name">Color</span>
        <div class="markas-colors">
          {#each MARKAS_PALETTE as color (color)}
            <button
              type="button"
              class="markas-swatch"
              class:selected={draftColor.toLowerCase() === color}
              style:--tag-color={color}
              aria-label={`Color ${color}`}
              aria-pressed={draftColor.toLowerCase() === color}
              onpointerdown={(event) => event.preventDefault()}
              onclick={() => { draftColor = color; }}
            ></button>
          {/each}
          <label class="markas-custom-color" title="Custom color" style:--tag-color={HEX.test(draftColor) ? draftColor : "#888888"}>
            <input
              type="color"
              value={HEX.test(draftColor) ? draftColor : MARKAS_PALETTE[0]}
              aria-label="Custom color"
              oninput={(event) => { draftColor = event.currentTarget.value; }}
            />
          </label>
        </div>
      </div>

      <div class="markas-footer">
        <label class="markas-frame" title="Colour the frame of the note this Mark as is inserted in or linked to">
          <input
            type="checkbox"
            checked={note.customMarkFrame === true}
            data-markas-frame
            onchange={(event) => setCustomMarkFrame(note.id, event.currentTarget.checked)}
          />
          <span>Frame</span>
        </label>
      </div>
      {#if error}<p class="markas-error" role="alert">{error}</p>{/if}
    </form>
  {/if}
</div>

<style>
  .markas-node {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: #d8d8d8;
    font-size: 11px;
    user-select: none;
  }

  .markas-head {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  .markas-tags {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .markas-tag {
    display: inline-flex;
    max-width: 100%;
    align-items: stretch;
    border: 1px solid color-mix(in srgb, var(--tag-color) 55%, #3a3a3a);
    border-radius: 999px;
    background: color-mix(in srgb, var(--tag-color) 16%, #242424);
  }

  .markas-tag.editing {
    outline: 1px solid var(--tag-color);
    outline-offset: 1px;
  }

  .markas-tag-label,
  .markas-tag-remove {
    border: 0;
    background: transparent;
    font: inherit;
    cursor: pointer;
    user-select: none;
  }

  .markas-tag-label {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 5px;
    padding: 2px 3px 2px 7px;
    color: var(--tag-color);
  }

  .markas-tag-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: none;
  }

  .markas-dot {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--tag-color);
  }

  .markas-tag-remove {
    display: grid;
    width: 18px;
    place-items: center;
    padding: 0 3px 0 0;
    color: color-mix(in srgb, var(--tag-color) 70%, #fff);
    opacity: 0.7;
  }

  .markas-tag-remove:hover { opacity: 1; }

  .markas-tag-remove svg,
  .markas-add svg {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Thin bar above the editor: click to fold / unfold it (the node height follows). */
  .markas-collapse {
    display: grid;
    width: 100%;
    height: 10px;
    place-items: center;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .markas-collapse-line {
    width: 100%;
    height: 2px;
    border-radius: 1px;
    background: #464646;
    transition: background 120ms ease;
  }

  .markas-collapse:hover .markas-collapse-line { background: var(--accent); }
  .markas-collapse.collapsed .markas-collapse-line { background: #5a5a5a; }

  .markas-editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .markas-field {
    display: grid;
    grid-template-columns: 34px 1fr;
    align-items: center;
    gap: 6px;
  }

  .markas-field-name {
    color: #9d9d9d;
  }

  .markas-text {
    min-width: 0;
    padding: 4px 6px;
    border: 1px solid #454545;
    border-radius: 3px;
    background: #1a1a1a;
    color: #eee;
    font: inherit;
    user-select: text;
  }

  .markas-text:focus { border-color: var(--accent); outline: none; }

  .markas-colors {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
  }

  .markas-swatch,
  .markas-custom-color {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--tag-color) 70%, #fff);
    border-radius: 50%;
    background: var(--tag-color);
    cursor: pointer;
  }

  .markas-swatch.selected {
    box-shadow: 0 0 0 2px #1f1f1f, 0 0 0 3px #eee;
  }

  /* Custom colour: a rainbow ring around the current custom colour; the native picker is invisible on top. */
  .markas-custom-color {
    position: relative;
    border: 2px solid transparent;
    background:
      linear-gradient(var(--tag-color), var(--tag-color)) padding-box,
      conic-gradient(#e58b83, #e5bd67, #91bd81, #70b7b4, #78a8d2, #aa8bd2, #d58bae, #e58b83) border-box;
  }

  .markas-custom-color input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .markas-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .markas-frame {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: #bdbdbd;
    cursor: pointer;
  }

  .markas-frame input {
    margin: 0;
    accent-color: var(--accent);
  }

  .markas-add {
    display: grid;
    flex: 0 0 auto;
    margin-left: auto;
    width: 22px;
    height: 22px;
    place-items: center;
    padding: 0;
    border: 1px solid #505050;
    border-radius: 50%;
    background: #2a2a2a;
    color: #e6e6e6;
    cursor: pointer;
  }

  .markas-add:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .markas-error {
    margin: 0;
    color: #e6a29d;
    line-height: 1.3;
  }
</style>
