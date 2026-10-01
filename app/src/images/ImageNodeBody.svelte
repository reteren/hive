<script lang="ts">
  import AttachmentImage from "../attachments/AttachmentImage.svelte";
  import GifView from "../attachments/GifView.svelte";
  import type { ImageRef } from "../attachments/types";

  let { image, selected, name, noteId, flipX, flipY }: {
    image?: ImageRef;
    selected: boolean;
    name: string;
    noteId: string;
    flipX?: true;
    flipY?: true;
  } = $props();
</script>

<div class="image-node-body" role="group" aria-label={name} ondragstart={(event) => event.preventDefault()}>
  {#if image?.mime === "image/gif"}
    <div class="image-node-picture-viewport" style:transform={`scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`}>
      <GifView
        {image}
        target={{ kind: "board", noteId }}
        hostSelected={selected}
        alt={name}
        class="image-node-picture"
        style="width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none"
        fit="fill"
      />
    </div>
  {:else if image}
    <div class="image-node-picture-viewport" style:transform={`scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`}>
      <AttachmentImage
        {image}
        alt={name}
        class="image-node-picture"
        style="width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none"
      />
    </div>
  {:else}
    <div class="image-node-state image-node-error" role="status">File missing: {name || "Image"}</div>
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

  .image-node-picture-viewport {
    position: absolute;
    inset: 0;
    transform-origin: center;
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
