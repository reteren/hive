<script lang="ts">
  import AttachmentImage from "../attachments/AttachmentImage.svelte";
  import type { ImageRef } from "../attachments/types";
  import { attachmentUrl } from "../attachments/service";

  let { image, selected, name }: { image?: ImageRef; selected: boolean; name: string } = $props();
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let loading = $state(true);
  let failed = $state(false);
  let stillReady = $state(false);
  let url = $derived(image ? attachmentUrl(image.file) : "");
  let isGif = $derived(image?.mime === "image/gif");

  $effect(() => {
    url;
    loading = true;
    failed = !url;
    stillReady = false;
  });

  function handleLoad(event: Event): void {
    const img = event.currentTarget;
    if (!(img instanceof HTMLImageElement)) return;
    loading = false;
    failed = false;
    if (!isGif || !canvasElement) return;
    const context = canvasElement.getContext("2d");
    if (!context || img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
    canvasElement.width = img.naturalWidth;
    canvasElement.height = img.naturalHeight;
    context.drawImage(img, 0, 0);
    stillReady = true;
  }

  function handleError(): void {
    loading = false;
    failed = true;
  }
</script>

<div class="image-node-body" role="group" aria-label={name} ondragstart={(event) => event.preventDefault()}>
  {#if image && (!isGif || failed || !url)}
    <AttachmentImage
      {image}
      alt={name}
      class="image-node-picture"
      style="width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none"
    />
  {:else if image && isGif}
    {#if url}
      <canvas bind:this={canvasElement} class="image-node-picture" aria-hidden="true" hidden={!stillReady || selected}></canvas>
      <img
        class="image-node-picture"
        src={url}
        alt={name}
        draggable="false"
        hidden={failed || !selected && stillReady}
        onload={handleLoad}
        onerror={handleError}
      />
      {#if loading && !failed}
        <div class="image-node-state">Loading image…</div>
      {/if}
    {:else}
      <AttachmentImage
        {image}
        alt={name}
        class="image-node-picture"
        style="width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none"
      />
    {/if}
  {:else}
    <div class="image-node-state image-node-error" role="status">File missing: {image?.name || image?.file || name || "Image"}</div>
  {/if}
</div>

<style>
  .image-node-body {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: inherit;
    background: #1c1c1c;
  }

  :global(.image-node-picture) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: fill;
    image-rendering: auto;
    pointer-events: none;
    user-select: none;
  }

  :global(.image-node-picture[hidden]) {
    display: none;
  }

  .image-node-state {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 8px;
    color: #a9a9a9;
    background: #202020;
    font-size: 11px;
    text-align: center;
    pointer-events: none;
  }

  .image-node-error {
    color: #bdbdbd;
    background: #242424;
  }
</style>
