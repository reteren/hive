<script lang="ts">
  import { tick } from "svelte";
  import { EditorSelection } from "@codemirror/state";
  import type { EditorView } from "@codemirror/view";
  import { camera, viewport } from "../board/camera.svelte";
  import type { Point } from "../board/cameraMath";
  import { clearFormatting, toggleHeadingLevel, toggleWrapper } from "../editor/formatting";
  import { insertMarkdownBlock, toggleMarkdownLines } from "../editor/markdownCommands";
  import { openHighlightPalette } from "../editor/highlightPalette";
  import { toggleCodeBlock, toggleLink, pastePlainText } from "../editor/noteEditorKeymap";
  import { followTextLink } from "../editor/createNoteEditor";
  import { boardPopupStyle, dismissBoardPopup } from "../ui/boardAnchor";
  import { addWordToSpellcheckDictionary, replaceSpellcheckWord } from "./spellcheck";
  import { closeSpellcheckMenu, spellcheckMenu } from "./contextMenu.svelte";
  import { buildNoteEditorContextMenu, type NoteMenuEntry, type NoteMenuItem, type NoteMenuSubmenu } from "./noteEditorContextMenuModel";

  const boardOrigin = $derived.by((): Point => {
    const rect = document.querySelector<HTMLElement>(".board")?.getBoundingClientRect();
    return rect ? { x: -rect.left, y: -rect.top } : { x: 0, y: 0 };
  });
  const hasSelection = $derived(Boolean(spellcheckMenu.editor && !spellcheckMenu.editor.state.selection.main.empty));
  const entries = $derived(buildNoteEditorContextMenu({
    hasSelection,
    spellContext: spellcheckMenu.context,
    suggestions: spellcheckMenu.suggestions,
    loading: spellcheckMenu.loading,
    linkUrl: spellcheckMenu.linkUrl,
  }));

  let popup = $state<HTMLDivElement>();
  let rootPanel = $state<HTMLDivElement>();
  let submenuPanel = $state<HTMLDivElement>();
  let activeSubmenu = $state<number | null>(null);
  let submenuPosition = $state({ left: 220, top: 0 });
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const activeMenu = $derived(activeSubmenu === null ? null : submenuAt(activeSubmenu));

  function submenuAt(index: number): NoteMenuSubmenu | null {
    const entry = entries[index];
    return entry && "kind" in entry && entry.kind === "submenu" ? entry : null;
  }

  function isSubmenu(entry: NoteMenuEntry): entry is NoteMenuSubmenu {
    return "kind" in entry && entry.kind === "submenu";
  }

  function cancelTimers(): void {
    if (openTimer !== null) clearTimeout(openTimer);
    if (closeTimer !== null) clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
  }

  function closeMenu(restoreFocus = false): void {
    cancelTimers();
    const view = spellcheckMenu.editor;
    activeSubmenu = null;
    closeSpellcheckMenu();
    if (restoreFocus) view?.focus();
  }

  $effect(() => {
    const open = spellcheckMenu.open;
    const anchor = spellcheckMenu.anchor;
    if (!open || !anchor) {
      cancelTimers();
      activeSubmenu = null;
      return;
    }
    activeSubmenu = null;
    void tick().then(() => rootPanel?.querySelector<HTMLButtonElement>("button[data-root-focusable]:not(:disabled)")?.focus());
  });

  function focusSubmenu(direction = 1): void {
    const buttons = [...(submenuPanel?.querySelectorAll<HTMLButtonElement>("button[data-submenu-focusable]:not(:disabled)") ?? [])];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0
      ? (direction > 0 ? 0 : buttons.length - 1)
      : (current + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  async function openSubmenu(index: number, moveFocus = false): Promise<void> {
    cancelTimers();
    if (!submenuAt(index)) return;
    activeSubmenu = index;
    await tick();
    if (activeSubmenu !== index || !popup || !rootPanel || !submenuPanel) return;
    placeSubmenu(index);
    if (moveFocus) focusSubmenu();
  }

  function scheduleSubmenuOpen(index: number): void {
    if (activeSubmenu === index) {
      if (closeTimer !== null) clearTimeout(closeTimer);
      closeTimer = null;
      return;
    }
    if (openTimer !== null) clearTimeout(openTimer);
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
    openTimer = setTimeout(() => {
      openTimer = null;
      void openSubmenu(index);
    }, 90);
  }

  function scheduleSubmenuClose(): void {
    if (openTimer !== null) clearTimeout(openTimer);
    openTimer = null;
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      activeSubmenu = null;
    }, 150);
  }

  function placeSubmenu(index: number): void {
    const trigger = rootPanel?.querySelector<HTMLButtonElement>(`button[data-menu-index="${index}"]`);
    if (!trigger || !submenuPanel || !rootPanel || !popup) return;
    const triggerRect = trigger.getBoundingClientRect();
    const rootRect = rootPanel.getBoundingClientRect();
    const scale = Math.max(0.01, camera.zoom / Math.max(0.01, spellcheckMenu.zoomAtOpen));
    const width = submenuPanel.offsetWidth * scale;
    const height = submenuPanel.offsetHeight * scale;
    const margin = 8;
    const fitsRight = triggerRect.right + width + margin <= window.innerWidth;
    const fitsLeft = triggerRect.left - width - margin >= 0;
    const screenLeft = fitsRight || !fitsLeft
      ? (fitsRight ? triggerRect.right + 4 : Math.max(margin, window.innerWidth - width - margin))
      : triggerRect.left - width - 4;
    const screenTop = Math.max(margin, Math.min(triggerRect.top, window.innerHeight - height - margin));
    submenuPosition = {
      left: (screenLeft - rootRect.left) / scale,
      top: (screenTop - rootRect.top) / scale,
    };
  }

  function rootFocusables(): HTMLButtonElement[] {
    return [...(rootPanel?.querySelectorAll<HTMLButtonElement>("button[data-root-focusable]:not(:disabled)") ?? [])];
  }

  function moveRootFocus(direction: 1 | -1): void {
    activeSubmenu = null;
    const buttons = rootFocusables();
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0
      ? (direction > 0 ? 0 : buttons.length - 1)
      : (current + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  function handleRootKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveRootFocus(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      activeSubmenu = null;
      const buttons = rootFocusables();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    } else if (event.key === "ArrowRight") {
      const index = Number((event.target as HTMLElement).closest<HTMLButtonElement>("button[data-menu-index]")?.dataset.menuIndex);
      if (Number.isInteger(index) && submenuAt(index)) {
        event.preventDefault();
        void openSubmenu(index, true);
      }
    } else if (event.key === "ArrowLeft" && activeSubmenu !== null) {
      event.preventDefault();
      const index = activeSubmenu;
      activeSubmenu = null;
      rootPanel?.querySelector<HTMLButtonElement>(`button[data-menu-index="${index}"]`)?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    }
  }

  function handleSubmenuKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusSubmenu(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const buttons = [...(submenuPanel?.querySelectorAll<HTMLButtonElement>("button[data-submenu-focusable]:not(:disabled)") ?? [])];
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      const index = activeSubmenu;
      activeSubmenu = null;
      if (index !== null) rootPanel?.querySelector<HTMLButtonElement>(`button[data-menu-index="${index}"]`)?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    }
  }

  function closeFromOutside(): void {
    closeMenu(false);
  }

  function finish(view: EditorView): void {
    closeMenu(false);
    view.focus();
  }

  async function addToDictionary(): Promise<void> {
    const view = spellcheckMenu.editor;
    const context = spellcheckMenu.context;
    if (!view || !context) return;
    try {
      await addWordToSpellcheckDictionary(context);
      if (spellcheckMenu.context === context) finish(view);
    } catch {
      if (spellcheckMenu.context === context) spellcheckMenu.error = "Could not add that word.";
    }
  }

  function copyLink(): void {
    const view = spellcheckMenu.editor;
    const url = spellcheckMenu.linkUrl;
    if (!view || !url) return;
    closeMenu(false);
    if (typeof navigator !== "undefined") void navigator.clipboard?.writeText(url).catch(() => undefined);
    view.focus();
  }

  function runFormat(view: EditorView, id: string): boolean {
    if (id === "format.bold") return toggleWrapper(view, "**");
    if (id === "format.italic") return toggleWrapper(view, "*");
    if (id === "format.strikethrough") return toggleWrapper(view, "~~");
    if (id === "format.code") return toggleWrapper(view, "`");
    if (id === "format.highlight") return openHighlightPalette(view);
    if (id === "format.link") return toggleLink(view);
    if (id === "format.clearFormatting") return clearFormatting(view);
    if (id === "format.list") return toggleMarkdownLines(view, "bullet");
    if (id === "format.orderedList") return toggleMarkdownLines(view, "ordered");
    if (id === "format.taskList") return toggleMarkdownLines(view, "task");
    if (id === "format.codeBlock") return toggleCodeBlock(view);
    if (id === "format.table") return insertMarkdownBlock(view, "table");
    if (id === "format.callout") return insertMarkdownBlock(view, "callout");
    if (id === "format.mathBlock") return insertMarkdownBlock(view, "math");
    if (id === "format.horizontalRule") return insertMarkdownBlock(view, "horizontalRule");
    const heading = /^format\.heading([1-6])$/u.exec(id);
    if (heading) return toggleHeadingLevel(view, Number(heading[1]));
    if (id === "format.clearHeading") return toggleHeadingLevel(view, 0);
    return false;
  }

  function activate(item: NoteMenuItem): void {
    if (item.disabled) return;
    const view = spellcheckMenu.editor;
    if (!view) return;
    if (item.id === "spellcheck.replace") {
      const context = spellcheckMenu.context;
      if (context) replaceSpellcheckWord(view, context, item.label);
      finish(view);
      return;
    }
    if (item.id === "spellcheck.addToDictionary") {
      void addToDictionary();
      return;
    }
    if (item.id === "link.open") {
      const url = spellcheckMenu.linkUrl;
      if (!url) return;
      closeMenu(false);
      followTextLink(url);
      view.focus();
      return;
    }
    if (item.id === "link.copy") {
      copyLink();
      return;
    }
    if (item.id === "cut" || item.id === "copy") {
      closeMenu(false);
      view.focus();
      try { document.execCommand(item.id); } catch { /* WebView clipboard access may be denied. */ }
      return;
    }
    if (item.id === "paste") {
      closeMenu(false);
      view.focus();
      if (typeof navigator !== "undefined") {
        void navigator.clipboard?.readText().then((text) => view.dispatch(view.state.replaceSelection(text))).catch(() => undefined);
      }
      return;
    }
    if (item.id === "edit.pastePlainText") {
      closeMenu(false);
      view.focus();
      pastePlainText(view);
      return;
    }
    if (item.id === "delete") {
      closeMenu(false);
      if (!view.state.selection.main.empty) view.dispatch(view.state.replaceSelection(""));
      view.focus();
      return;
    }
    if (item.id === "select-all") {
      closeMenu(false);
      view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
      view.focus();
      return;
    }
    if (item.id === "format.highlight") {
      closeMenu(false);
      openHighlightPalette(view);
      return;
    }
    closeMenu(false);
    runFormat(view, item.id);
    view.focus();
  }

  function activateEntry(entry: NoteMenuEntry): void {
    if (!isSubmenu(entry) && !("separator" in entry)) activate(entry);
  }
</script>

{#if spellcheckMenu.open && spellcheckMenu.anchor}
  <div
    class="editor-context-popup"
    bind:this={popup}
    data-spellcheck-menu
    data-link-context-menu
    data-selection-ignore
    role="presentation"
    style={`${boardPopupStyle(camera, viewport, spellcheckMenu.anchor, spellcheckMenu.zoomAtOpen, boardOrigin)};position:fixed`}
    use:dismissBoardPopup={{ close: closeFromOutside, escape: false }}
    onpointerdown={(event) => { event.stopPropagation(); if (event.button === 0) event.preventDefault(); }}
    oncontextmenu={(event) => event.preventDefault()}
  >
    <div
      bind:this={rootPanel}
      class="editor-context-menu editor-context-root"
      data-menu-level="root"
      role="menu"
      tabindex="-1"
      aria-label="Note text actions"
      onkeydown={handleRootKeydown}
      onpointerleave={scheduleSubmenuClose}
    >
      {#each entries as entry, index}
        {#if "separator" in entry}
          <div class="editor-context-divider" role="separator"></div>
        {:else if isSubmenu(entry)}
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={activeSubmenu === index}
            data-root-focusable
            data-menu-index={index}
            onclick={() => void openSubmenu(index, true)}
            onpointerenter={() => scheduleSubmenuOpen(index)}
            onpointerleave={scheduleSubmenuClose}
          >
            <span>{entry.label}</span><span class="editor-context-trailing" aria-hidden="true">›</span>
          </button>
        {:else}
          <button
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            data-root-focusable={!entry.disabled}
            data-menu-index={index}
            data-menu-action={entry.id}
            onclick={() => activateEntry(entry)}
            onpointerenter={() => activeSubmenu !== null && scheduleSubmenuClose()}
          >
            <span>{entry.label}</span>
            {#if entry.shortcut}<kbd>{entry.shortcut}</kbd>{/if}
          </button>
          {#if entry.id === "spellcheck.addToDictionary" && spellcheckMenu.error}
            <div class="editor-context-error" role="alert">{spellcheckMenu.error}</div>
          {/if}
        {/if}
      {/each}
    </div>

    {#if activeMenu}
      <div
        bind:this={submenuPanel}
        class="editor-context-menu editor-context-submenu"
        data-menu-level="submenu"
        data-menu-parent={activeSubmenu}
        role="menu"
        tabindex="-1"
        aria-label={activeMenu.label}
        style={`left:${submenuPosition.left}px;top:${submenuPosition.top}px`}
        onkeydown={handleSubmenuKeydown}
        onpointerenter={() => { if (closeTimer !== null) clearTimeout(closeTimer); closeTimer = null; }}
        onpointerleave={scheduleSubmenuClose}
      >
        {#each activeMenu.items as item, itemIndex}
          {#if "separator" in item}
            <div class="editor-context-divider" role="separator"></div>
          {:else}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              data-submenu-focusable={!item.disabled}
              data-menu-action={item.id}
              data-menu-index={itemIndex}
              onclick={() => activate(item)}
            >
              <span>{item.label}</span>
              {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
            </button>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .editor-context-popup { z-index: 1300; width: max-content; color: var(--text); }
  .editor-context-menu { box-sizing: border-box; display: flex; width: 216px; max-height: min(78vh, 520px); flex-direction: column; gap: 1px; overflow: auto; padding: 4px; border: 1px solid #4b4b4b; border-radius: 5px; background: var(--bg-panel); box-shadow: 0 5px 18px rgb(0 0 0 / 45%); color: var(--text); }
  .editor-context-root { position: relative; }
  .editor-context-submenu { position: absolute; z-index: 1; }
  .editor-context-menu button { display: flex; min-height: 24px; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 18px; padding: 3px 7px; border: 0; border-radius: 3px; background: transparent; color: var(--text); font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
  .editor-context-menu button:hover, .editor-context-menu button:focus-visible { background: var(--bg-hover); outline: none; }
  .editor-context-menu button:disabled { color: var(--text-dim); cursor: default; }
  .editor-context-menu button:disabled:hover { background: transparent; }
  .editor-context-menu kbd { color: var(--text-dim); font: inherit; font-size: 9px; white-space: nowrap; }
  .editor-context-trailing { color: var(--text-dim); font-size: 15px; line-height: 1; }
  .editor-context-divider { height: 1px; flex: 0 0 auto; margin: 3px 2px; background: rgb(255 255 255 / 12%); }
  .editor-context-error { flex: 0 0 auto; padding: 4px 7px; color: #efaaa5; font-size: 10px; }
</style>
