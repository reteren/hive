<script lang="ts">
  import { attachmentUrl } from "../attachments/service";
  import type { Note } from "../model/note";
  import NoteBody from "../editor/NoteBody.svelte";

  let { note }: { note: Note } = $props();
  let failed = $state(false);
  let media = $derived(note.media?.kind === "video" ? note.media : null);
  let source = $derived(media ? attachmentUrl(media.file) : "");

  $effect(() => {
    void source;
    failed = false;
  });
</script>

<section class="video-node-body" data-video-node={note.id}>
  {#if !source || failed}
    <div class="video-error" data-video-error role="status">File missing: {media?.name ?? note.name}</div>
  {:else}
    <!-- The stored media contract has no separate caption-track field; the editable node caption remains below. -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      class="video-player"
      data-video-player
      data-video-file={media?.file}
      src={source}
      controls
      preload="metadata"
      playsinline
      aria-label={`Video player for ${media?.name ?? note.name}`}
      data-selection-ignore
      onerror={() => { failed = true; }}
    ></video>
  {/if}
  <div class="video-caption" data-video-caption>
    <NoteBody {note} />
  </div>
</section>

<style>
  .video-node-body { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
  .video-player { display: block; width: 100%; height: auto; max-height: 480px; background: #111; }
  .video-error { display: grid; min-height: 52px; place-items: center; padding: 8px; color: #bdbdbd; background: #242424; font-size: 11px; overflow-wrap: anywhere; }
  .video-caption { min-width: 0; }
</style>
