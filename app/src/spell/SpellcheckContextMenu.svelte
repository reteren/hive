<script lang="ts">
  import { camera, viewport } from "../board/camera.svelte";
  import type { Point } from "../board/cameraMath";
  import { boardPopupStyle, dismissBoardPopup } from "../ui/boardAnchor";
  import { addWordToSpellcheckDictionary, replaceSpellcheckWord } from "./spellcheck";
  import { closeSpellcheckMenu, spellcheckMenu } from "./contextMenu.svelte";

  const boardOrigin = $derived.by((): Point => {
    const rect = document.querySelector<HTMLElement>(".board")?.getBoundingClientRect();
    return rect ? { x: -rect.left, y: -rect.top } : { x: 0, y: 0 };
  });

  function replace(suggestion: string): void {
    if (spellcheckMenu.editor && spellcheckMenu.context) {
      replaceSpellcheckWord(spellcheckMenu.editor, spellcheckMenu.context, suggestion);
      spellcheckMenu.editor.focus();
    }
    closeSpellcheckMenu();
  }

  async function addToDictionary(): Promise<void> {
    const editor = spellcheckMenu.editor;
    const context = spellcheckMenu.context;
    if (!editor || !context) return;
    try {
      await addWordToSpellcheckDictionary(context);
      closeSpellcheckMenu();
    } catch {
      spellcheckMenu.error = "Could not add that word.";
    }
  }
</script>

{#if spellcheckMenu.open && spellcheckMenu.anchor}
  <div
    class="spell-context-menu"
    data-spellcheck-menu
    role="menu"
    aria-label="Spelling suggestions"
    style={`${boardPopupStyle(camera, viewport, spellcheckMenu.anchor, spellcheckMenu.zoomAtOpen, boardOrigin)};position:fixed`}
    use:dismissBoardPopup={{ close: closeSpellcheckMenu, escape: true }}
  >
    <div class="spell-context-title">Suggestions for “{spellcheckMenu.context?.word ?? ""}”</div>
    {#if spellcheckMenu.loading}
      <div class="spell-context-empty">Checking…</div>
    {:else if spellcheckMenu.suggestions.length}
      {#each spellcheckMenu.suggestions as suggestion (suggestion)}
        <button type="button" role="menuitem" onclick={() => void replace(suggestion)}>{suggestion}</button>
      {/each}
    {:else}
      <div class="spell-context-empty">No suggestions</div>
    {/if}
    {#if spellcheckMenu.error}<div class="spell-context-error" role="alert">{spellcheckMenu.error}</div>{/if}
    <div class="spell-context-divider"></div>
    <button type="button" role="menuitem" onclick={() => void addToDictionary()}>Add to dictionary</button>
  </div>
{/if}

<style>
  .spell-context-menu { z-index: 1300; display: flex; width: 220px; max-height: 290px; flex-direction: column; gap: 2px; padding: 5px; border: 1px solid #4b4b4b; border-radius: 4px; background: var(--bg-panel); box-shadow: 0 5px 18px rgb(0 0 0 / 55%); color: var(--text); transform-origin: 0 0; }
  .spell-context-title { padding: 4px 6px; color: var(--text-dim); font-size: 10px; overflow-wrap: anywhere; }
  .spell-context-menu button { min-height: 25px; padding: 4px 7px; border: 0; border-radius: 3px; background: transparent; color: var(--text); font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
  .spell-context-menu button:hover, .spell-context-menu button:focus-visible { background: var(--bg-hover); outline: none; }
  .spell-context-empty { padding: 4px 7px; color: var(--text-dim); font-size: 10px; }
  .spell-context-error { padding: 4px 7px; color: #efaaa5; font-size: 10px; }
  .spell-context-divider { height: 1px; margin: 3px 1px; background: #434343; }
</style>
