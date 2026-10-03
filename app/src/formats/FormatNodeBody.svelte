<script lang="ts">
  import { onDestroy } from "svelte";
  import { exportAttachmentAs, attachmentUrl, reportImportError } from "../attachments/service";
  import type { MediaRef } from "../attachments/types";
  import { board } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import { formatWheelUsesEditor } from "./formatScroll";
  import { project } from "../project/project.svelte";
  import { createFormatEditor } from "./formatEditor";
  import { clearFormatDraft, formatDraft, setFormatDraft } from "./formatDrafts";
  import { saveFormatText } from "./formatActions";
  import { hasUnsavedFormatChanges, mediaExtension } from "./formatLogic";
  import { encodeFormatText, shouldHighlightFormatText, type FormatTextEncoding } from "./textEncoding";
  import { loadFormatText } from "./formatLoad";
  import type { EditorView } from "@codemirror/view";

  let { note }: { note: Note } = $props();
  let editorHost = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;
  let loadedFile = "";
  let savedText = "";
  let textEncoding: FormatTextEncoding = { bom: false, lineEnding: "\n" };
  let errorMessage = $state("");
  let dirty = $state(false);
  let saving = $state(false);
  let generation = 0;

  let media = $derived(note.media?.kind === "text" ? note.media : null);
  let displayName = $derived(media?.name || note.name || "File");

  function handleWheel(event: WheelEvent): void {
    if (view && formatWheelUsesEditor(view.scrollDOM, event.deltaX, event.deltaY)) {
      event.stopPropagation();
    }
  }

  $effect(() => {
    const currentMedia = media;
    const host = editorHost;
    if (!currentMedia || !host || currentMedia.file === loadedFile) return;
    loadedFile = currentMedia.file;
    errorMessage = "";
    view?.destroy();
    view = null;
    const currentGeneration = ++generation;
    const currentProjectPath = project.path;
    void loadEditor(currentMedia, host, currentGeneration, currentProjectPath);
  });

  onDestroy(() => {
    generation += 1;
    view?.destroy();
    view = null;
  });

  async function loadEditor(currentMedia: MediaRef, host: HTMLDivElement, request: number, projectPath: string): Promise<void> {
    try {
      const source = attachmentUrl(currentMedia.file);
      const { text: loadedText, encoding, byteLength } = await loadFormatText(currentMedia.file, source);
      if (request !== generation) return;
      textEncoding = encoding;
      const draft = formatDraft(note.id, currentMedia, projectPath);
      savedText = loadedText;
      const initialText = draft ?? loadedText;
      dirty = hasUnsavedFormatChanges(initialText, loadedText);
      view?.destroy();
      view = createFormatEditor(
        host,
        mediaExtension(currentMedia),
        initialText,
        (text) => {
          const latest = board.notes[note.id]?.media;
          if (!latest || latest.kind !== "text") return;
          setFormatDraft(note.id, latest, project.path, text);
          dirty = hasUnsavedFormatChanges(text, savedText);
        },
        () => { void saveCurrentDraft(); },
        shouldHighlightFormatText(byteLength),
      );
    } catch (error) {
      if (request === generation) {
        const message = error instanceof Error ? error.message : String(error);
        errorMessage = message.startsWith("Could not load file:") ? message : `Could not load file: ${message || "Unknown error"}`;
      }
    }
  }

  async function saveCurrentDraft(): Promise<boolean> {
    const current = note.media;
    const text = view?.state.doc.toString();
    if (!current || current.kind !== "text" || text === undefined || !dirty || saving) return false;
    saving = true;
    errorMessage = "";
    try {
      const result = await saveFormatText(note.id, encodeFormatText(text, textEncoding));
      if (!result.ok) {
        errorMessage = result.error;
        reportImportError(result.error);
        return false;
      }
      const { previous, media: next } = result;
      clearFormatDraft(note.id, previous, project.path);
      setFormatDraft(note.id, next, project.path, text);
      loadedFile = next.file;
      savedText = text;
      dirty = false;
      return true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      reportImportError(errorMessage);
      return false;
    } finally {
      saving = false;
    }
  }

  async function saveAs(): Promise<void> {
    if (dirty && !(await saveCurrentDraft())) return;
    const current = board.notes[note.id]?.media;
    if (!current || current.kind !== "text") return;
    try {
      await exportAttachmentAs(current, current.name || note.name);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      reportImportError(errorMessage);
    }
  }
</script>

<section
  class="format-node-body"
  class:manual-height={note.height !== null}
  class:compact-height={note.height !== null && note.height < 14}
  aria-label={`Text file ${displayName}`}
>
  <div class="format-file-row">
    <span>Copy in project · {displayName}</span>
    {#if dirty}<span class="format-unsaved-dot" title="Unsaved changes" aria-label="Unsaved changes">●</span>{/if}
  </div>
  {#if errorMessage}
    <div class="format-error" role="alert">{errorMessage}</div>
  {/if}
  <div class="format-editor" class:has-error={Boolean(errorMessage)} bind:this={editorHost} onwheel={handleWheel}></div>
  <footer class="format-actions" data-selection-ignore>
    <button type="button" disabled={!dirty || saving} onclick={() => { void saveCurrentDraft(); }}>Save</button>
    <button type="button" disabled={!media} onclick={() => { void saveAs(); }}>Save as…</button>
    {#if saving}<span role="status">Saving…</span>{/if}
  </footer>
</section>

<style>
  .format-node-body {
    display: flex;
    min-width: 0;
    min-height: 250px;
    flex: 1 1 auto;
    flex-direction: column;
    overflow: hidden;
    color: var(--text);
    background: #202020;
  }

  .format-node-body.manual-height {
    height: 100%;
    min-height: 0;
  }

  .format-node-body.compact-height .format-file-row {
    display: none;
  }

  .format-node-body.compact-height .format-actions {
    min-height: 22px;
    padding: 1px 4px;
  }

  .format-node-body.compact-height .format-actions button {
    padding: 1px 5px;
  }

  .format-file-row {
    display: flex;
    flex: 0 0 auto;
    min-height: 28px;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    color: var(--text-dim);
    background: #292929;
    border-bottom: 1px solid #414141;
    font: 11px/1.2 system-ui, sans-serif;
  }

  .format-file-row > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .format-unsaved-dot {
    color: #f0b45c;
    font-size: 9px;
  }

  .format-editor {
    min-width: 0;
    min-height: 215px;
    flex: 1 1 auto;
    overflow: hidden;
    background: #202020;
  }

  .manual-height .format-editor,
  .manual-height .format-error {
    min-height: 0;
  }

  .format-editor.has-error { display: none; }

  .format-editor :global(.cm-editor) {
    height: 100%;
    font-size: 12px;
  }

  .format-error {
    display: grid;
    min-height: 215px;
    flex: 1 1 auto;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
    color: #ffb5a8;
    text-align: center;
    background: #251e1d;
  }

  .format-actions {
    display: flex;
    flex: 0 0 auto;
    min-height: 30px;
    align-items: center;
    gap: 5px;
    padding: 3px 6px;
    border-top: 1px solid #414141;
    background: #292929;
    font: 11px system-ui, sans-serif;
  }

  .format-actions button {
    padding: 3px 8px;
    color: var(--text);
    background: #383838;
    border: 1px solid #515151;
    border-radius: 3px;
    cursor: pointer;
  }

  .format-actions button:hover:not(:disabled) { background: #454545; }
  .format-actions button:disabled { opacity: 0.45; cursor: default; }
  .format-actions span { margin-left: auto; color: var(--text-dim); }
</style>
