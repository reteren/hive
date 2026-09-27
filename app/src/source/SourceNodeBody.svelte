<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { openPath, openUrl } from "@tauri-apps/plugin-opener";
  import type { Note } from "../model/note";
  import { setSourceField } from "./actions.svelte";
  import {
    emptySource,
    sourceFileLabel,
    sourceResourceStatus,
    validateSourceUrl,
    type SourceEditMeta,
    type SourceField,
    type SourceTextEditKind,
  } from "./logic";
  import { checkSourceFileAvailability, invalidateSourceFileAvailability } from "./fileAvailability.svelte";

  let { note }: { note: Note } = $props();
  let source = $derived(note.source ?? emptySource());
  let urlOpenFailed = $state(false);
  let urlOpenError = $state("");
  let fileError = $state("");
  let fileAvailability = $state<"available" | "missing" | "unknown">("unknown");
  let choosingFile = $state(false);
  let openingFile = $state(false);
  let openingUrl = $state(false);
  let urlGroup = 0;
  let descriptionGroup = 0;
  const selectionBeforeInput: Record<"url" | "description", { start: number; end: number } | null> = {
    url: null,
    description: null,
  };

  const urlValidation = $derived(source.url ? validateSourceUrl(source.url) : null);
  const resourceStatus = $derived(sourceResourceStatus(source, fileAvailability, urlOpenFailed));
  const fileLabel = $derived(source.filePath ? sourceFileLabel(source.filePath) : null);

  $effect(() => {
    const path = note.source?.filePath;
    if (!path) {
      fileAvailability = "unknown";
      fileError = "";
      return;
    }
    void refreshFileAvailability(path);
  });

  async function refreshFileAvailability(path = note.source?.filePath): Promise<void> {
    if (!path) return;
    const state = await checkSourceFileAvailability(path);
    if (note.source?.filePath === path) fileAvailability = state;
  }

  function meta(
    field: SourceField,
    kind: SourceTextEditKind,
    group: number,
    before?: { start: number; end: number } | null,
    after?: { start: number; end: number },
  ): SourceEditMeta {
    return {
      field,
      kind,
      group,
      at: performance.now(),
      ...(before ? { selectionBefore: before } : {}),
      ...(after ? { selectionAfter: after } : {}),
    };
  }

  function selectionOf(target: HTMLInputElement | HTMLTextAreaElement): { start: number; end: number } {
    return { start: target.selectionStart ?? 0, end: target.selectionEnd ?? 0 };
  }

  function rememberSelection(field: "url" | "description", event: Event): void {
    selectionBeforeInput[field] = selectionOf(event.currentTarget as HTMLInputElement | HTMLTextAreaElement);
  }

  function editUrl(event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    const value = target.value;
    const before = selectionBeforeInput.url;
    const after = selectionOf(target);
    selectionBeforeInput.url = after;
    urlOpenFailed = false;
    urlOpenError = "";
    setSourceField(note.id, "url", value || null, meta("url", inputEditKind(event), urlGroup, before, after));
  }

  function editDescription(event: Event): void {
    const target = event.currentTarget as HTMLTextAreaElement;
    const value = target.value;
    const before = selectionBeforeInput.description;
    const after = selectionOf(target);
    selectionBeforeInput.description = after;
    setSourceField(note.id, "description", value, meta("description", inputEditKind(event), descriptionGroup, before, after));
  }

  function inputEditKind(event: Event): SourceTextEditKind {
    const inputType = event instanceof InputEvent ? event.inputType : "insertText";
    if (inputType.startsWith("insertText") || inputType === "insertLineBreak") return "typing";
    if (inputType === "deleteContentBackward") return "backspace";
    if (inputType === "deleteContentForward") return "forward-delete";
    return "atomic";
  }

  function stopBoardHotkeys(event: KeyboardEvent): void {
    event.stopPropagation();
  }

  async function chooseFile(): Promise<void> {
    if (choosingFile) return;
    choosingFile = true;
    fileError = "";
    try {
      const selected = await open({
        title: "Choose a source file",
        multiple: false,
        directory: false,
        defaultPath: source.filePath ?? undefined,
      });
      if (typeof selected !== "string" || !selected) return;
      invalidateSourceFileAvailability(selected);
      setSourceField(note.id, "filePath", selected, meta("filePath", "atomic", 0));
      fileAvailability = "unknown";
    } catch {
      fileError = "Could not open the file picker.";
    } finally {
      choosingFile = false;
    }
  }

  function clearFile(): void {
    if (!source.filePath) return;
    setSourceField(note.id, "filePath", null, meta("filePath", "atomic", 0));
    fileAvailability = "unknown";
    fileError = "";
  }

  async function openSourceUrl(): Promise<void> {
    const validation = source.url ? validateSourceUrl(source.url) : null;
    if (!validation?.valid || openingUrl) return;
    openingUrl = true;
    urlOpenFailed = false;
    urlOpenError = "";
    try {
      await openUrl(validation.url);
    } catch {
      urlOpenFailed = true;
      urlOpenError = "Could not open this URL.";
    } finally {
      openingUrl = false;
    }
  }

  async function openSourceFile(): Promise<void> {
    const path = source.filePath;
    if (!path || openingFile || resourceStatus.file === "missing") return;
    openingFile = true;
    fileError = "";
    try {
      await openPath(path);
      fileAvailability = "available";
    } catch {
      invalidateSourceFileAvailability(path);
      const state = await checkSourceFileAvailability(path);
      if (note.source?.filePath === path) fileAvailability = state;
      fileError = state === "missing" ? "File not found." : "Could not open this file.";
    } finally {
      openingFile = false;
    }
  }
</script>

<div
  class="source-body"
  data-source-node={note.id}
  data-selection-ignore
  role="region"
  aria-label={`Source details for ${note.name}`}
  onfocusin={() => { if (source.filePath) void refreshFileAvailability(source.filePath); }}
>
  <label class="source-field">
    <span>URL</span>
    <input
      type="url"
      value={source.url ?? ""}
      placeholder="https://example.com"
      aria-label="Source URL"
      data-source-url
      onkeydown={(event) => rememberSelection("url", event)}
      onbeforeinput={(event) => rememberSelection("url", event)}
      onselect={(event) => rememberSelection("url", event)}
      oninput={editUrl}
      onblur={() => { urlGroup += 1; }}
    />
  </label>
  {#if urlValidation && !urlValidation.valid}
    <p class="source-message error" data-source-url-error role="alert">{urlValidation.error}</p>
  {:else if urlOpenError}
    <p class="source-message error" data-source-url-error role="alert">{urlOpenError}</p>
  {/if}
  {#if source.url}
    <button
      type="button"
      class="source-action"
      data-source-open-url
      disabled={!urlValidation?.valid || openingUrl}
      onclick={openSourceUrl}
      onkeydown={stopBoardHotkeys}
    >{openingUrl ? "Opening…" : "Open URL"}</button>
  {/if}

  <div class="source-file-row">
    <span class="source-label">File</span>
    <button type="button" class="source-action" data-source-choose-file disabled={choosingFile} onclick={chooseFile} onkeydown={stopBoardHotkeys}>
      {choosingFile ? "Choosing…" : source.filePath ? "Choose another…" : "Choose file…"}
    </button>
  </div>
  {#if fileLabel}
    <div class="source-file" data-source-file={source.filePath}>
      <strong title={fileLabel.name}>{fileLabel.name}</strong>
      <span title={fileLabel.folder}>{fileLabel.folder}</span>
      <button type="button" class="source-clear" aria-label="Remove source file" data-source-clear-file onclick={clearFile} onkeydown={stopBoardHotkeys}>×</button>
    </div>
  {/if}
  {#if resourceStatus.file === "missing"}
    <p class="source-message error" data-source-file-missing role="status">File not found.</p>
  {:else if fileError}
    <p class="source-message error" data-source-file-error role="alert">{fileError}</p>
  {/if}
  {#if source.filePath}
    <button
      type="button"
      class="source-action"
      data-source-open-file
      disabled={openingFile || resourceStatus.file === "missing"}
      onclick={openSourceFile}
      onkeydown={stopBoardHotkeys}
    >{openingFile ? "Opening…" : "Open file"}</button>
  {/if}

  <label class="source-field source-description-field">
    <span>Description</span>
    <textarea
      value={source.description}
      placeholder="Notes about this source"
      aria-label="Source description"
      data-source-description
      onkeydown={(event) => rememberSelection("description", event)}
      onbeforeinput={(event) => rememberSelection("description", event)}
      onselect={(event) => rememberSelection("description", event)}
      oninput={editDescription}
      onblur={() => { descriptionGroup += 1; }}
    ></textarea>
  </label>
  <p class="source-hint">Add links and files with these fields; drag and drop is not supported.</p>
</div>

<style>
  .source-body { display: flex; min-width: 0; min-height: 0; height: 100%; flex: 1 1 auto; flex-direction: column; gap: 6px; overflow: auto; font-size: 10px; }
  .source-field { display: grid; min-width: 0; gap: 3px; color: var(--text-dim); }
  .source-field input, .source-field textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: 4px 5px; border: 1px solid #494949; border-radius: 3px; outline: none; color: var(--text); background: #202020; font: inherit; user-select: text; }
  .source-field input:focus, .source-field textarea:focus { border-color: #777; }
  .source-field textarea { min-height: 40px; resize: vertical; line-height: 1.4; }
  .source-file-row { display: flex; align-items: center; gap: 6px; }
  .source-label { color: var(--text-dim); }
  .source-action, .source-clear { border: 1px solid #4b4b4b; border-radius: 3px; color: var(--text); background: #2a2a2a; font: inherit; cursor: pointer; }
  .source-action { align-self: flex-start; padding: 4px 6px; }
  .source-file-row .source-action { margin-left: auto; }
  .source-action:hover:not(:disabled), .source-clear:hover { border-color: var(--accent); }
  .source-action:disabled { opacity: 0.45; cursor: default; }
  .source-file { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 5px; }
  .source-file strong, .source-file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .source-file strong { grid-column: 1; color: var(--text); }
  .source-file span { grid-column: 1; color: var(--text-dim); font-size: 9px; }
  .source-clear { grid-column: 2; grid-row: 1 / span 2; width: 20px; height: 20px; padding: 0; font-size: 14px; line-height: 1; }
  .source-message, .source-hint { margin: 0; line-height: 1.35; }
  .source-message.error { color: #df9089; }
  .source-hint { color: var(--text-dim); font-size: 9px; }
  :global(.note-card[data-kind="source"] .note-content) { display: flex; min-height: 0; padding: 4px 5px; overflow: hidden; }
</style>
