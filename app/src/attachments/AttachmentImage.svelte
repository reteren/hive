<script lang="ts">
  import { attachmentUrl } from "./service";
  import type { ImageRef } from "./types";

  interface Props {
    image: ImageRef;
    class?: string;
    style?: string;
    alt?: string;
  }

  let { image, class: className = "", style = "", alt = image.name ?? image.file }: Props = $props();
  let state = $state<"loading" | "ready" | "error">("loading");
  let src = $derived(attachmentUrl(image.file));

  $effect(() => {
    void src;
    state = "loading";
  });
</script>

{#if state === "error" || !src}
  <div class={`attachment-image-missing ${className}`} style={style} role="img" aria-label={`File missing: ${image.name ?? image.file}`}>
    <span>File missing: {image.name ?? image.file}</span>
  </div>
{:else}
  <img
    {src}
    {alt}
    class={`attachment-image ${className}`}
    style={style}
    class:attachment-image-loading={state === "loading"}
    onload={() => { state = "ready"; }}
    onerror={() => { state = "error"; }}
  />
{/if}

<style>
  .attachment-image {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .attachment-image-loading {
    opacity: 0;
  }

  .attachment-image-missing {
    display: grid;
    min-width: 72px;
    min-height: 52px;
    place-items: center;
    box-sizing: border-box;
    padding: 8px;
    overflow: hidden;
    border: 1px solid #484848;
    background: #242424;
    color: #a8a8a8;
    font-size: 11px;
    text-align: center;
    overflow-wrap: anywhere;
  }
</style>
