<script lang="ts">
  import { onMount } from "svelte";
  import { EditorSelection, EditorState, Prec } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
  import { spellcheckExtension } from "../spell/spellcheck";
  import { spellSettings } from "../spell/settings.svelte";
  import { spellcheckMenu } from "../spell/contextMenu.svelte";

  /**
   * One-line title editor: a tiny CodeMirror so node titles get the same spellcheck as note text
   * (underlines, inline suggestions, right-click corrections). Enter commits, Escape cancels,
   * leaving the field commits — except while its own spellcheck menu is open.
   */
  let { value = $bindable(""), label, onCommit, onCancel, onInput }: {
    value: string;
    label: string;
    onCommit: () => void;
    onCancel: () => void;
    onInput?: () => void;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let menuWasOurs = false;

  const singleLine = EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || transaction.newDoc.lines === 1) return transaction;
    const flat = transaction.newDoc.toString().replace(/[\r\n]+/g, " ");
    return [transaction, {
      changes: { from: 0, to: transaction.newDoc.length, insert: flat },
      selection: EditorSelection.cursor(Math.min(flat.length, transaction.newSelection.main.head)),
      sequential: true,
    }];
  });

  function leaveIfUnfocused(): void {
    if (!view || view.hasFocus) return;
    if (spellcheckMenu.open && spellcheckMenu.editor === view) return;
    onCommit();
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        selection: EditorSelection.range(0, value.length),
        extensions: [
          singleLine,
          spellcheckExtension(() => ({
            enabled: spellSettings.enabled,
            languages: spellSettings.languages,
            inlineSuggestions: spellSettings.inlineSuggestions,
          })),
          Prec.high(keymap.of([
            { key: "Enter", run: () => { onCommit(); return true; } },
            { key: "Escape", run: () => { onCancel(); return true; } },
          ])),
          history(),
          keymap.of([...standardKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ spellcheck: "false", "aria-label": label, "data-title-input": "" }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            value = update.state.doc.toString();
            onInput?.();
          }),
          EditorView.domEventHandlers({
            blur: () => { setTimeout(leaveIfUnfocused, 0); },
          }),
        ],
      }),
    });
    view.focus();
    return () => {
      view?.destroy();
      view = null;
    };
  });

  // The spellcheck menu takes focus; when it closes without handing focus back, finish the rename.
  $effect(() => {
    const ours = spellcheckMenu.open && view !== null && spellcheckMenu.editor === view;
    if (ours) menuWasOurs = true;
    else if (menuWasOurs) {
      menuWasOurs = false;
      setTimeout(leaveIfUnfocused, 0);
    }
  });
</script>

<div class="title-input" bind:this={host} data-selection-ignore></div>

<style>
  .title-input {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    color: var(--text);
    background: #202020;
    border: 1px solid var(--accent);
    border-radius: 2px;
    font: inherit;
    user-select: text;
  }

  .title-input :global(.cm-editor) {
    font: inherit;
    background: transparent;
  }

  .title-input :global(.cm-editor.cm-focused) {
    outline: none;
  }

  .title-input :global(.cm-scroller) {
    overflow: hidden;
    font: inherit;
    line-height: inherit;
  }

  .title-input :global(.cm-content) {
    padding: 2px 3px;
    white-space: pre;
    caret-color: var(--text);
  }

  .title-input :global(.cm-line) {
    padding: 0;
  }
</style>
