<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { updateNote } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import { setSourceAttachment, setSourceField, setSourceResourceValue } from "./actions.svelte";
  import { importSourceFilePath } from "../attachments/service";
  import {
    emptySource,
    parseSourceValue,
    sourceHasPicker,
    validateSourceUrl,
    type SourceEditMeta,
    type SourceEditField,
    type SourceTextEditKind,
  } from "./logic";
  import { checkSourceFileAvailability, invalidateSourceFileAvailability } from "./fileAvailability.svelte";

  let { note }: { note: Note } = $props();
  let source = $derived(note.source ?? emptySource());
  let sourceValue = $derived(source.file ? "" : source.url ?? source.filePath ?? "");
  let parsedValue = $derived(parseSourceValue(sourceValue));
  let urlOpenError = $state("");
  let fileError = $state("");
  let fileAvailability = $state<"available" | "missing" | "unknown">("unknown");
  let choosingFile = $state(false);
  let opening = $state(false);
  let descriptionField: HTMLTextAreaElement | undefined;
  let resourceGroup = 0;
  let descriptionGroup = 0;
  const selectionBeforeInput: Record<"resource" | "description", { start: number; end: number } | null> = {
    resource: null,
    description: null,
  };

  const urlValidation = $derived(parsedValue.kind === "url" ? validateSourceUrl(parsedValue.value) : null);
  const isMissingSelectedPath = $derived(parsedValue.kind === "path" && source.filePath === parsedValue.value && fileAvailability === "missing");
  const openDisabled = $derived(
    opening || (!source.file && parsedValue.kind === "empty") || (parsedValue.kind === "url" && !urlValidation?.valid) || isMissingSelectedPath,
  );

  onMount(() => {
    if (note.height !== null) updateNote(note.id, { height: null });
    resizeDescriptionField();
  });

  $effect(() => {
    const description = source.description;
    void tick().then(() => {
      if (descriptionField?.value === description) resizeDescriptionField(descriptionField);
    });
  });

  $effect(() => {
    const path = note.source?.filePath;
    if (!path) {
      fileAvailability = "unknown";
      fileError = "";
      return;
    }
    const timer = window.setTimeout(() => void refreshFileAvailability(path), 300);
    return () => window.clearTimeout(timer);
  });

  async function refreshFileAvailability(path = note.source?.filePath): Promise<void> {
    if (!path) return;
    const state = await checkSourceFileAvailability(path);
    if (note.source?.filePath === path) fileAvailability = state;
  }

  function meta(
    field: SourceEditField,
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

  function rememberSelection(field: "resource" | "description", event: Event): void {
    selectionBeforeInput[field] = selectionOf(event.currentTarget as HTMLInputElement | HTMLTextAreaElement);
  }

  function editResource(event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    const value = target.value;
    const before = selectionBeforeInput.resource;
    const after = selectionOf(target);
    selectionBeforeInput.resource = after;
    urlOpenError = "";
    fileError = "";
    const parsed = parseSourceValue(value);
    if (parsed.kind === "path") {
      invalidateSourceFileAvailability(parsed.value);
      fileAvailability = "unknown";
    }
    setSourceResourceValue(note.id, value, meta("resource", inputEditKind(event), resourceGroup, before, after));
  }

  function editDescription(event: Event): void {
    const target = event.currentTarget as HTMLTextAreaElement;
    resizeDescriptionField(target);
    const value = target.value;
    const before = selectionBeforeInput.description;
    const after = selectionOf(target);
    selectionBeforeInput.description = after;
    setSourceField(note.id, "description", value, meta("description", inputEditKind(event), descriptionGroup, before, after));
  }

  function resizeDescriptionField(target = descriptionField): void {
    if (!target) return;
    target.style.height = "auto";
    const style = getComputedStyle(target);
    const borderHeight = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
    const minimumHeight = Number.parseFloat(style.minHeight) || 0;
    target.style.height = `${Math.max(minimumHeight, target.scrollHeight + borderHeight)}px`;
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
      const stored = await importSourceFilePath(selected);
      setSourceAttachment(note.id, stored.file, meta("resource", "atomic", 0));
      fileAvailability = "available";
      urlOpenError = "";
    } catch (error) {
      fileError = error instanceof Error ? error.message : "Could not import this file.";
    } finally {
      choosingFile = false;
    }
  }

  async function openResource(): Promise<void> {
    if (source.file) {
      opening = true;
      fileError = "";
      try {
        await invoke("attachment_open_source_file", { file: source.file });
      } catch {
        fileError = "Could not open this project file.";
      } finally {
        opening = false;
      }
      return;
    }
    if (opening || parsedValue.kind === "empty") return;
    fileError = "";
    urlOpenError = "";

    if (parsedValue.kind === "url") {
      const validation = validateSourceUrl(parsedValue.value);
      if (!validation.valid) return;
      opening = true;
      try {
        await openUrl(validation.url);
      } catch {
        urlOpenError = "Could not open this URL.";
      } finally {
        opening = false;
      }
      return;
    }

    const path = parsedValue.value;
    if (isMissingSelectedPath) return;
    opening = true;
    try {
      await invoke("source_open_path", { filePath: path });
      fileAvailability = "available";
    } catch {
      invalidateSourceFileAvailability(path);
      const state = await checkSourceFileAvailability(path);
      if (note.source?.filePath === path) fileAvailability = state;
      fileError = state === "missing" ? "File not found." : "Could not open this path.";
    } finally {
      opening = false;
    }
  }

  async function revealAttachment(): Promise<void> {
    if (!source.file) return;
    try {
      await invoke("attachment_reveal_source_file", { file: source.file });
    } catch {
      fileError = "Could not reveal this project file.";
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
    <span>URL/File</span>
    <input
      type="text"
      value={sourceValue}
      placeholder={'https://… or C:\\Users\\Example\\file.mp4'}
      aria-label="Source URL or file path"
      data-source-url-file
      onkeydown={(event) => rememberSelection("resource", event)}
      onbeforeinput={(event) => rememberSelection("resource", event)}
      onselect={(event) => rememberSelection("resource", event)}
      oninput={editResource}
      onblur={() => { resourceGroup += 1; }}
    />
  </label>
  {#if urlValidation && !urlValidation.valid}
    <p class="source-message error" data-source-url-error role="alert">{urlValidation.error}</p>
  {:else if urlOpenError}
    <p class="source-message error" data-source-url-error role="alert">{urlOpenError}</p>
  {/if}
  {#if source.filePath}
    <p class="source-file" data-source-file-path title={source.filePath}>{source.filePath}</p>
  {/if}
  {#if source.file}
    <p class="source-file" data-source-attachment={source.file} title={source.file}>attachments/{source.file}</p>
  {/if}
  {#if source.filePath && fileAvailability === "missing"}
    <p class="source-message error" data-source-file-missing role="status">File not found.</p>
  {:else if fileError}
    <p class="source-message error" data-source-file-error role="alert">{fileError}</p>
  {/if}
  <div class="source-actions">
    <button type="button" class="source-action" data-source-open disabled={openDisabled} title={parsedValue.kind === "path" ? parsedValue.value : undefined} onclick={openResource} onkeydown={stopBoardHotkeys}>
      {opening ? "Opening…" : "Open"}
    </button>
    {#if source.file}
      <button type="button" class="source-action" data-source-reveal disabled={opening} onclick={revealAttachment} onkeydown={stopBoardHotkeys}>Show in folder</button>
    {/if}
    {#if sourceHasPicker(source)}
      <button type="button" class="source-action" data-source-choose-file disabled={choosingFile} onclick={chooseFile} onkeydown={stopBoardHotkeys}>
        {choosingFile ? "Choosing…" : "Choose file…"}
      </button>
    {/if}
  </div>

  <label class="source-field source-description-field">
    <span>Description</span>
    <textarea
      value={source.description}
      bind:this={descriptionField}
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
</div>

<style>
  .source-body { display: flex; min-width: 0; flex: 0 0 auto; flex-direction: column; gap: 6px; overflow: visible; font-size: 10px; }
  .source-field { display: grid; min-width: 0; gap: 3px; color: var(--text-dim); }
  .source-field input, .source-field textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: 4px 5px; border: 1px solid #494949; border-radius: 3px; outline: none; color: var(--text); background: #202020; font: inherit; user-select: text; }
  .source-field input:focus, .source-field textarea:focus { border-color: #777; }
  .source-field textarea { display: block; min-height: 40px; resize: none; overflow: hidden; line-height: 1.4; }
  .source-action { border: 1px solid #4b4b4b; border-radius: 3px; color: var(--text); background: #2a2a2a; font: inherit; cursor: pointer; }
  .source-action { align-self: flex-start; padding: 4px 6px; }
  .source-actions { display: flex; gap: 5px; }
  .source-action:hover:not(:disabled) { border-color: var(--accent); }
  .source-action:disabled { opacity: 0.45; cursor: default; }
  .source-file { min-width: 0; margin: 0; overflow: hidden; color: var(--text-dim); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
  .source-message { margin: 0; line-height: 1.35; }
  .source-message.error { color: #df9089; }
  :global(.note-card[data-kind="source"] .note-content) { display: flex; min-height: 0; padding: 4px 5px; overflow: visible; }
</style>
