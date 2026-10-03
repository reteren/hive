<script lang="ts">
  import { mount, onMount, unmount } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import AttachmentImage from "../attachments/AttachmentImage.svelte";
  import GifView from "../attachments/GifView.svelte";
  import type { ImageRef } from "../attachments/types";
  import { board } from "../model/board.svelte";
  import { teleportToObject, teleportToPoint } from "../navigation/navigate";
  import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
  import { createMarkdownFragment, linkedNoteIds } from "./markdown";
  import { prepareMarkdownPreview } from "./markdownSyntax";

  let { text, noteId }: { text: string; noteId: string } = $props();
  let container: HTMLDivElement;
  let visible = $state(false);
  let renderedText: string | null = null;
  let renderedAsMarkdown = false;
  let renderedNotesKey = "";
  let mountedInlineImages: Array<Record<string, unknown>> = [];

  function clearInlineImages(): void {
    for (const component of mountedInlineImages) void unmount(component);
    mountedInlineImages = [];
  }

  function renderMarkdown(source: string): void {
    clearInlineImages();
    const prepared = prepareMarkdownPreview(source);
    container.replaceChildren(createMarkdownFragment(prepared.text, document, {
      resolveNote: (noteId) => {
        const note = board.notes[noteId];
        return note ? { id: note.id, name: note.name } : undefined;
      },
      openExternal: openUrl,
      teleportToPoint: (point) => teleportToPoint(point, { label: "Text link" }),
      teleportToNote: (noteId) => teleportToObject(noteId, { label: "Text link" }),
      onNotice: showLinkStatus,
    }));

    const labels = Array.from(container.querySelectorAll<HTMLElement>(".md-image-label"));
    for (const inlineImage of prepared.inlineImages) {
      const label = labels.find((candidate) => candidate.textContent === inlineImage.marker);
      if (!label) continue;
      const host = document.createElement("div");
      host.className = "md-inline-image-host";
      host.dataset.inlineImage = inlineImage.file;
      host.style.width = `${inlineImage.widthPercent}%`;
      label.replaceWith(host);

      const image: ImageRef = {
        file: inlineImage.file,
        mime: inlineImage.file.toLowerCase().endsWith(".gif") ? "image/gif" : "",
        size: 0,
        name: inlineImage.alt || undefined,
        naturalWidth: 0,
        naturalHeight: 0,
      };
      if (image.mime === "image/gif") {
        const component = mount(GifView, {
          target: host,
          props: {
            image,
            target: { kind: "inline", noteId, position: inlineImage.position },
            hoverWhenSelected: true,
            alt: inlineImage.alt,
            class: "md-inline-image",
            style: "width:100%;height:auto;max-height:none;object-fit:contain",
          },
        });
        mountedInlineImages.push(component);
      } else {
        const component = mount(AttachmentImage, {
          target: host,
          props: {
            image,
            alt: inlineImage.alt,
            class: "md-inline-image",
            style: "width:100%;height:auto;max-height:none;object-fit:contain",
          },
        });
        mountedInlineImages.push(component);
      }
    }
  }

  onMount(() => {
    if (!("IntersectionObserver" in window)) {
      visible = true;
      return () => clearInlineImages();
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) visible = true;
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      clearInlineImages();
    };
  });

  $effect(() => {
    const source = text;
    const shouldRenderMarkdown = visible;
    const linkedIds = linkedNoteIds(source);
    const notesKey = JSON.stringify(linkedIds.map((id) => [id, board.notes[id]?.name ?? null]));
    if (
      !container ||
      (source === renderedText && shouldRenderMarkdown === renderedAsMarkdown && notesKey === renderedNotesKey)
    ) return;

    if (shouldRenderMarkdown) {
      renderMarkdown(source);
    }
    else {
      clearInlineImages();
      container.textContent = source;
    }
    renderedText = source;
    renderedAsMarkdown = shouldRenderMarkdown;
    renderedNotesKey = notesKey;
  });
</script>

<div bind:this={container} class="markdown-preview"></div>

<style>
  .markdown-preview {
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
    color: var(--text);
    font-size: 14px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .markdown-preview :global(p) {
    margin: 0.35em 0;
    white-space: normal;
  }

  .markdown-preview :global(p:first-child),
  .markdown-preview :global(h1:first-child),
  .markdown-preview :global(h2:first-child),
  .markdown-preview :global(h3:first-child),
  .markdown-preview :global(h4:first-child),
  .markdown-preview :global(h5:first-child),
  .markdown-preview :global(h6:first-child),
  .markdown-preview :global(ul:first-child),
  .markdown-preview :global(ol:first-child),
  .markdown-preview :global(blockquote:first-child),
  .markdown-preview :global(pre:first-child),
  .markdown-preview :global(table:first-child) {
    margin-top: 0;
  }

  .markdown-preview :global(p:last-child),
  .markdown-preview :global(h1:last-child),
  .markdown-preview :global(h2:last-child),
  .markdown-preview :global(h3:last-child),
  .markdown-preview :global(h4:last-child),
  .markdown-preview :global(h5:last-child),
  .markdown-preview :global(h6:last-child),
  .markdown-preview :global(ul:last-child),
  .markdown-preview :global(ol:last-child),
  .markdown-preview :global(blockquote:last-child),
  .markdown-preview :global(pre:last-child),
  .markdown-preview :global(table:last-child) {
    margin-bottom: 0;
  }

  .markdown-preview :global(h1),
  .markdown-preview :global(h2),
  .markdown-preview :global(h3),
  .markdown-preview :global(h4),
  .markdown-preview :global(h5),
  .markdown-preview :global(h6) {
    margin: 0.65em 0 0.2em;
    line-height: 1.2;
  }

  .markdown-preview :global(h1) { font-size: 1.35em; }
  .markdown-preview :global(h2) { font-size: 1.2em; }
  .markdown-preview :global(h3) { font-size: 1.1em; }
  .markdown-preview :global(h4),
  .markdown-preview :global(h5),
  .markdown-preview :global(h6) { font-size: 1em; }

  .markdown-preview :global(ul),
  .markdown-preview :global(ol) {
    margin: 0.4em 0;
    padding-left: 1.55em;
  }

  .markdown-preview :global(li) {
    padding-left: 0.1em;
  }

  .markdown-preview :global(li > p) {
    margin: 0.15em 0;
  }

  .markdown-preview :global(blockquote) {
    margin: 0.45em 0;
    padding-left: 0.7em;
    border-left: 2px solid var(--text-dim);
    color: var(--text-dim);
  }

  .markdown-preview :global(pre) {
    margin: 0.45em 0;
    padding: 0.5em 0.6em;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: #1c1c1c;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .markdown-preview :global(code) {
    font-family: var(--mono-font);
    font-size: 0.94em;
  }

  .markdown-preview :global(.md-inline-code) {
    padding: 0 0.2em;
    border-radius: 2px;
    background: #2a2a2a;
    color: #e5c786;
    white-space: pre-wrap;
  }

  .markdown-preview :global(hr) {
    height: 1px;
    margin: 0.65em 0;
    border: 0;
    background: #555;
  }

  .markdown-preview :global(.md-highlight) {
    padding: 0 0.08em;
    border-radius: 2px;
  }

  .markdown-preview :global(.md-link-text) {
    color: #83b8e8;
    text-decoration: underline;
    text-decoration-color: #557998;
    text-underline-offset: 2px;
  }

  .markdown-preview :global(.md-link-text.is-clickable) {
    cursor: pointer;
  }

  .markdown-preview :global(.md-link-text.is-note-link) {
    text-decoration-color: #83b8e8;
    text-decoration-line: overline underline;
    text-decoration-style: solid;
    text-underline-offset: 2px;
  }

  .markdown-preview :global(.md-link-text.is-point-link) {
    text-decoration-style: dotted;
  }

  .markdown-preview :global(.md-link-text.is-clickable:focus-visible) {
    border-radius: 2px;
    outline: 1px solid var(--accent);
    outline-offset: 2px;
  }

  .markdown-preview :global(.md-link-text.is-missing) {
    color: #d88982;
    text-decoration-color: #8d5550;
  }

  .markdown-preview :global(.md-link-missing-label) {
    color: #b77770;
    font-size: 0.9em;
    font-style: italic;
  }

  .markdown-preview :global(.md-task-checkbox) {
    display: inline-flex;
    width: 0.92em;
    height: 0.92em;
    align-items: center;
    justify-content: center;
    margin-right: 0.45em;
    border: 1px solid #8c8c8c;
    border-radius: 2px;
    vertical-align: -0.08em;
  }

  .markdown-preview :global(.md-task-checkbox.is-checked) {
    border-color: var(--accent);
    background: var(--accent);
  }

  .markdown-preview :global(.md-task-checkbox.is-checked::after) {
    content: "✓";
    color: #181818;
    font-size: 0.8em;
    font-weight: 700;
    line-height: 1;
  }

  .markdown-preview :global(.md-table) {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 0.94em;
  }

  .markdown-preview :global(.md-inline-image-host) {
    display: block;
    max-width: 100%;
    margin: 0.35em 0;
  }

  .markdown-preview :global(.md-inline-image) {
    max-width: 100%;
  }

  .markdown-preview :global(.md-table th),
  .markdown-preview :global(.md-table td) {
    padding: 0.25em 0.4em;
    border: 1px solid #4a4a4a;
    text-align: left;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .markdown-preview :global(.md-table th) {
    background: #2b2b2b;
    font-weight: 600;
  }
</style>
