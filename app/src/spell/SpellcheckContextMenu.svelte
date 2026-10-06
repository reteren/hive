<script lang="ts">
  import { EditorSelection } from "@codemirror/state";
  import type { EditorView } from "@codemirror/view";
  import { toggleHeadingLevel, toggleWrapper } from "../editor/formatting";
  import { toggleCodeBlock, toggleLink } from "../editor/noteEditorKeymap";
  import { toggleMarkdownLines } from "../editor/markdownCommands";
  import { openHighlightPalette } from "../editor/highlightPalette";
  import { followTextLink } from "../editor/createNoteEditor";
  import { shiftIndentation } from "../editor/listCommands";
  import { camera, viewport } from "../board/camera.svelte";
  import type { Point } from "../board/cameraMath";
  import { boardPopupStyle, dismissBoardPopup } from "../ui/boardAnchor";
  import { addWordToSpellcheckDictionary, replaceSpellcheckWord } from "./spellcheck";
  import { closeSpellcheckMenu, spellcheckMenu } from "./contextMenu.svelte";

  const boardOrigin = $derived.by((): Point => {
    const rect = document.querySelector<HTMLElement>(".board")?.getBoundingClientRect();
    return rect ? { x: -rect.left, y: -rect.top } : { x: 0, y: 0 };
  });

  const hasSelection = $derived(Boolean(spellcheckMenu.editor && !spellcheckMenu.editor.state.selection.main.empty));

  function finish(view: EditorView): void {
    closeSpellcheckMenu();
    view.focus();
  }

  function replace(suggestion: string): void {
    const view = spellcheckMenu.editor;
    const context = spellcheckMenu.context;
    if (!view || !context) return;
    replaceSpellcheckWord(view, context, suggestion);
    finish(view);
  }

  async function addToDictionary(): Promise<void> {
    const view = spellcheckMenu.editor;
    const context = spellcheckMenu.context;
    if (!view || !context) return;
    try {
      await addWordToSpellcheckDictionary(context);
      finish(view);
    } catch {
      spellcheckMenu.error = "Could not add that word.";
    }
  }

  function format(run: (view: EditorView) => boolean): void {
    const view = spellcheckMenu.editor;
    if (!view) return;
    closeSpellcheckMenu();
    run(view);
    view.focus();
  }

  function clipboard(action: "cut" | "copy" | "paste"): void {
    const view = spellcheckMenu.editor;
    if (!view) return;
    closeSpellcheckMenu();
    view.focus();
    if (action === "paste") {
      void navigator.clipboard?.readText().then((text) => view.dispatch(view.state.replaceSelection(text))).catch(() => undefined);
    } else {
      try { document.execCommand(action); } catch { /* WebView clipboard permissions can reject the command. */ }
    }
  }

  function deleteSelection(): void {
    format((view) => {
      if (view.state.selection.main.empty) return false;
      view.dispatch(view.state.replaceSelection(""));
      return true;
    });
  }

  function selectAll(): void {
    format((view) => {
      view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
      return true;
    });
  }

  function openLink(): void {
    const view = spellcheckMenu.editor;
    const url = spellcheckMenu.linkUrl;
    if (!url) return;
    closeSpellcheckMenu();
    followTextLink(url);
    view?.focus();
  }

  async function copyLink(): Promise<void> {
    const view = spellcheckMenu.editor;
    const url = spellcheckMenu.linkUrl;
    if (!url) return;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    closeSpellcheckMenu();
    view?.focus();
  }
</script>

{#if spellcheckMenu.open && spellcheckMenu.anchor}
  <div
    class="editor-context-menu"
    data-spellcheck-menu
    data-link-context-menu
    data-selection-ignore
    role="menu"
    tabindex="-1"
    aria-label="Note text actions"
    style={`${boardPopupStyle(camera, viewport, spellcheckMenu.anchor, spellcheckMenu.zoomAtOpen, boardOrigin)};position:fixed`}
    use:dismissBoardPopup={{ close: closeSpellcheckMenu, escape: true }}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#if spellcheckMenu.context}
      <div class="editor-context-title">Suggestions for “{spellcheckMenu.context.word}”</div>
      {#if spellcheckMenu.loading}
        <div class="editor-context-empty">Checking…</div>
      {:else if spellcheckMenu.suggestions.length}
        {#each spellcheckMenu.suggestions as suggestion (suggestion)}
          <button type="button" role="menuitem" onclick={() => replace(suggestion)}>{suggestion}</button>
        {/each}
      {:else}
        <div class="editor-context-empty">No suggestions</div>
      {/if}
      {#if spellcheckMenu.error}<div class="editor-context-error" role="alert">{spellcheckMenu.error}</div>{/if}
      <button type="button" role="menuitem" onclick={() => void addToDictionary()}>Add to dictionary</button>
      <div class="editor-context-divider" role="separator"></div>
    {/if}

    {#if spellcheckMenu.linkUrl}
      <button type="button" role="menuitem" onclick={openLink}>Open link</button>
      <button type="button" role="menuitem" onclick={() => void copyLink()}>Copy link address</button>
      <div class="editor-context-divider" role="separator"></div>
    {/if}

    <button type="button" role="menuitem" onclick={() => format((view) => toggleWrapper(view, "**"))}>Bold <kbd>Ctrl+B</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleWrapper(view, "*"))}>Italic <kbd>Ctrl+I</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleWrapper(view, "`"))}>Inline code <kbd>Ctrl+E</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleWrapper(view, "~~"))}>Strikethrough <kbd>Ctrl+Shift+X</kbd></button>
    <button type="button" role="menuitem" onclick={() => format(toggleLink)}>Link <kbd>Ctrl+K</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleHeadingLevel(view, 1))}>Heading 1 <kbd>Ctrl+1</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleHeadingLevel(view, 2))}>Heading 2 <kbd>Ctrl+2</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleHeadingLevel(view, 3))}>Heading 3 <kbd>Ctrl+3</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleHeadingLevel(view, 4))}>Heading 4 <kbd>Ctrl+4</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleHeadingLevel(view, 5))}>Heading 5 <kbd>Ctrl+5</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleHeadingLevel(view, 6))}>Heading 6 <kbd>Ctrl+6</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleHeadingLevel(view, 0))}>Remove heading <kbd>Ctrl+0</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleMarkdownLines(view, "bullet"))}>Bullet list <kbd>Ctrl+Shift+8</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleMarkdownLines(view, "ordered"))}>Numbered list <kbd>Ctrl+Shift+7</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleMarkdownLines(view, "task"))}>Checklist <kbd>Ctrl+Shift+9</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleMarkdownLines(view, "quote"))}>Quote <kbd>Ctrl+Shift+.</kbd></button>
    <button type="button" role="menuitem" onclick={() => { const view = spellcheckMenu.editor; closeSpellcheckMenu(); if (view) openHighlightPalette(view); }}>Highlight <kbd>Ctrl+Shift+H</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => toggleCodeBlock(view))}>Code block <kbd>Ctrl+Shift+K</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => shiftIndentation(view, 1))}>Indent <kbd>Tab</kbd></button>
    <button type="button" role="menuitem" onclick={() => format((view) => shiftIndentation(view, -1))}>Outdent <kbd>Shift+Tab</kbd></button>
    <div class="editor-context-divider" role="separator"></div>
    <button type="button" role="menuitem" disabled={!hasSelection} onclick={() => clipboard("cut")}>Cut <kbd>Ctrl+X</kbd></button>
    <button type="button" role="menuitem" disabled={!hasSelection} onclick={() => clipboard("copy")}>Copy <kbd>Ctrl+C</kbd></button>
    <button type="button" role="menuitem" onclick={() => clipboard("paste")}>Paste <kbd>Ctrl+V</kbd></button>
    <button type="button" role="menuitem" disabled={!hasSelection} onclick={deleteSelection}>Delete</button>
    <button type="button" role="menuitem" onclick={selectAll}>Select all <kbd>Ctrl+A</kbd></button>
  </div>
{/if}

<style>
  .editor-context-menu { z-index: 1300; display: flex; width: 238px; max-height: min(78vh, 520px); flex-direction: column; gap: 2px; overflow: auto; padding: 5px; border: 1px solid #4b4b4b; border-radius: 4px; background: var(--bg-panel); box-shadow: 0 5px 18px rgb(0 0 0 / 55%); color: var(--text); transform-origin: 0 0; }
  .editor-context-menu button { display: flex; min-height: 25px; align-items: center; justify-content: space-between; gap: 14px; padding: 4px 7px; border: 0; border-radius: 3px; background: transparent; color: var(--text); font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
  .editor-context-menu button:hover, .editor-context-menu button:focus-visible { background: var(--bg-hover); outline: none; }
  .editor-context-menu button:disabled { color: var(--text-dim); cursor: default; }
  .editor-context-menu button:disabled:hover { background: transparent; }
  .editor-context-menu kbd { color: var(--text-dim); font: inherit; font-size: 9px; white-space: nowrap; }
  .editor-context-title { padding: 4px 6px; color: var(--text-dim); font-size: 10px; overflow-wrap: anywhere; }
  .editor-context-empty, .editor-context-error { padding: 4px 7px; color: var(--text-dim); font-size: 10px; }
  .editor-context-error { color: #efaaa5; }
  .editor-context-divider { height: 1px; flex: 0 0 auto; margin: 3px 1px; background: #434343; }
</style>
