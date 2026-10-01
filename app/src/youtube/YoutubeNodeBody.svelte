<script lang="ts">
  import { onMount } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { board, updateNote } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
  import {
    youtubeEmbedErrorReason,
    youtubeEmbedUrl,
    youtubeOEmbedUrl,
    parseYouTubePlayerMessage,
    youtubeThumbnailUrl,
  } from "./logic";

  let { note }: { note: Note } = $props();
  let frame = $state<HTMLIFrameElement | null>(null);
  let playing = $state(false);
  let embedError = $state<string | null>(null);
  let playerUnavailable = $state(false);
  let playerResponded = $state(false);
  let thumbnailFailed = $state(false);
  // Plain (non-reactive) guard: writing a $state here re-ran the effect and its cleanup aborted the oEmbed request.
  let requestedVideoId: string | null = null;
  let youtube = $derived(note.type === "youtube" ? note.youtube : undefined);
  let title = $derived(youtube?.title || youtube?.videoId || "YouTube video");
  let thumbnail = $derived(youtube ? youtubeThumbnailUrl(youtube.videoId) : "");
  let embed = $derived(youtube ? youtubeEmbedUrl(youtube, typeof location === "undefined" ? "" : location.origin) : "");

  $effect(() => {
    const current = youtube;
    if (!current || current.title && current.author || requestedVideoId === current.videoId) return;
    requestedVideoId = current.videoId;
    const controller = new AbortController();
    const noteId = note.id;
    const videoId = current.videoId;
    void fetch(youtubeOEmbedUrl(current.url), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("YouTube metadata is unavailable.");
        return response.json() as Promise<unknown>;
      })
      .then((value) => {
        if (!isRecord(value)) return;
        const titleValue = nonEmptyString(value.title);
        const author = nonEmptyString(value.author_name);
        if (!titleValue && !author) return;
        const latest = board.notes[noteId];
        if (latest?.type !== "youtube" || latest.youtube?.videoId !== videoId) return;
        updateNote(noteId, {
          youtube: {
            ...latest.youtube,
            ...(titleValue ? { title: titleValue } : {}),
            ...(author ? { author } : {}),
          },
        });
      })
      .catch(() => {
        // Offline and blocked metadata lookup both leave the video ID as the title.
      });
    return () => controller.abort();
  });

  $effect(() => {
    const activeFrame = frame;
    const hasResponded = playerResponded;
    if (!playing || !activeFrame || hasResponded || typeof window === "undefined") return;

    const targetOrigin = "https://www.youtube-nocookie.com";
    const announceListening = (): void => {
      activeFrame.contentWindow?.postMessage(JSON.stringify({
        event: "listening",
        id: activeFrame.id,
        channel: "widget",
      }), targetOrigin);
    };
    playerUnavailable = false;
    announceListening();
    const interval = window.setInterval(announceListening, 250);
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
      if (!playerResponded) {
        playerUnavailable = true;
      }
    }, 8_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  });

  onMount(() => {
    const onMessage = (event: MessageEvent): void => {
      if (!frame || event.source !== frame.contentWindow || !isYouTubePlayerOrigin(event.origin)) return;
      const message = parseYouTubePlayerMessage(event.data);
      if (!message) return;
      playerResponded = true;
      playerUnavailable = false;
      if (message.kind === "error") embedError = message.reason;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  function startPlayback(): void {
    embedError = null;
    playerUnavailable = false;
    playerResponded = false;
    playing = true;
  }

  async function openOnYouTube(): Promise<void> {
    if (!youtube) return;
    try {
      await openUrl(youtube.url);
    } catch {
      showLinkStatus("Could not open this YouTube link.");
    }
  }

  function isYouTubePlayerOrigin(origin: string): boolean {
    try {
      const host = new URL(origin).hostname.toLocaleLowerCase();
      return host === "youtube.com" || host === "www.youtube.com" || host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com";
    } catch {
      return false;
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function nonEmptyString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
  }
</script>

<section class="youtube-node-body" data-youtube-node={note.id}>
  {#if !youtube}
    <div class="youtube-error" role="status">YouTube link missing.</div>
  {:else if embedError}
    <div class="youtube-error" data-youtube-error role="alert">
      <span>This video can't be played inside hive ({embedError})</span>
      <button type="button" data-selection-ignore onclick={() => { void openOnYouTube(); }}>Open on YouTube</button>
    </div>
  {:else if playerUnavailable}
    <div class="youtube-error" data-youtube-player-timeout role="status">
      <span>The embedded player did not respond.</span>
      <button type="button" data-selection-ignore onclick={() => { void openOnYouTube(); }}>Open on YouTube</button>
    </div>
  {:else if playing}
    <iframe
      bind:this={frame}
      id={`youtube-player-${note.id}`}
      data-youtube-embed
      title={title}
      src={embed}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
      data-selection-ignore
      onerror={() => { embedError = "The YouTube player could not be loaded."; }}
    ></iframe>
  {:else}
    <button class="youtube-preview" type="button" data-selection-ignore aria-label={`Play ${title}`} onclick={startPlayback}>
      <span class="youtube-thumbnail" data-youtube-thumbnail>
        {#if !thumbnailFailed}
          <img src={thumbnail} alt="" onerror={() => { thumbnailFailed = true; }} />
        {/if}
        <span class="youtube-play" aria-hidden="true">▶</span>
      </span>
      <span class="youtube-title">{title}</span>
      {#if youtube.author}<span class="youtube-author">{youtube.author}</span>{/if}
    </button>
  {/if}
</section>

<style>
  .youtube-node-body { display: block; min-width: 0; }
  .youtube-preview { display: flex; width: 100%; flex-direction: column; gap: 5px; padding: 0; overflow: hidden; border: 0; color: #dedfe2; background: transparent; text-align: left; cursor: pointer; }
  .youtube-thumbnail { position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: #18191c; }
  .youtube-thumbnail img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .youtube-play { position: absolute; inset: 50% auto auto 50%; display: grid; width: 42px; height: 30px; place-items: center; border-radius: 8px; color: white; background: #d22d32; transform: translate(-50%, -50%); font-size: 15px; }
  .youtube-title { display: -webkit-box; overflow: hidden; font-size: 11px; font-weight: 650; line-clamp: 2; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .youtube-author { overflow: hidden; color: #989ba2; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  iframe { display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; background: #101114; }
  .youtube-error { display: flex; min-height: 72px; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 10px; color: #d6d6d7; background: #242529; font-size: 11px; text-align: center; overflow-wrap: anywhere; }
  .youtube-error button { padding: 5px 8px; border: 1px solid #555962; border-radius: 3px; color: #f1d16d; background: #2c2e33; cursor: pointer; }
  .youtube-preview:focus-visible, .youtube-error button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
