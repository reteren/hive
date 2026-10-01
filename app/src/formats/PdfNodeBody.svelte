<script lang="ts">
  import type { Note } from "../model/note";
  import { attachmentUrl } from "../attachments/service";

  let { note }: { note: Note } = $props();
  let failed = $state(false);
  let source = $derived(note.media?.kind === "pdf" ? attachmentUrl(note.media.file) : "");
  let displayName = $derived(note.media?.name || note.name || "PDF");

  $effect(() => {
    source;
    failed = false;
  });
</script>

<div class="pdf-node-body" aria-label={displayName}>
  {#if source && !failed}
    <iframe
      class="pdf-viewer"
      title={displayName}
      src={source}
      onerror={() => { failed = true; }}
    ></iframe>
  {:else}
    <div class="pdf-error" role="status">File missing: {displayName}</div>
  {/if}
</div>

<style>
  .pdf-node-body {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: #202020;
  }

  .pdf-viewer {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 0;
    border: 0;
    background: #202020;
  }

  .pdf-error {
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 0;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
    color: #ffb5a8;
    text-align: center;
    background: #251e1d;
    border: 1px solid #653b35;
  }
</style>
