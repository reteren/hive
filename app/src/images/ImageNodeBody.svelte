<script lang="ts">
  import { board } from "../model/board.svelte";
  import AttachmentImage from "../attachments/AttachmentImage.svelte";
  import GifView from "../attachments/GifView.svelte";
  import { attachmentIsFullyTransparent } from "../attachments/imageTransparency";
  import type { ImageRef } from "../attachments/types";
  import { clampImageOpacity } from "./imageLogic";
  import { eraseSessionCanvas } from "../attachments/imageErase.svelte";

  let { image, selected, name, noteId, flipX, flipY }: {
    image?: ImageRef;
    selected: boolean;
    name: string;
    noteId: string;
    flipX?: true;
    flipY?: true;
  } = $props();
  let opacity = $derived(clampImageOpacity(board.notes[noteId]?.opacity ?? 1));
  let fullyTransparent = $state(false);
  /** While the picture is being erased, its working canvas is shown instead (live, no reloads). */
  let eraseCanvas = $derived(eraseSessionCanvas(noteId));

  function mountCanvas(host: HTMLElement, canvas: HTMLCanvasElement): { update(next: HTMLCanvasElement): void; destroy(): void } {
    let current = canvas;
    current.classList.add("image-node-picture");
    host.append(current);
    return {
      update(next) {
        if (next === current) return;
        current.remove();
        current = next;
        current.classList.add("image-node-picture");
        host.append(current);
      },
      destroy() { current.remove(); },
    };
  }

  $effect(() => {
    const currentImage = image;
    fullyTransparent = false;
    if (!currentImage || currentImage.mime === "image/gif") return;

    let current = true;
    void attachmentIsFullyTransparent(currentImage).then((isTransparent) => {
      if (current && image?.file === currentImage.file) fullyTransparent = isTransparent;
    });
    return () => { current = false; };
  });
</script>

<div class="image-node-body" role="group" aria-label={name} ondragstart={(event) => event.preventDefault()}>
  <div
    class="image-node-frame-outline"
    class:visible={fullyTransparent}
    data-image-frame-outline
    aria-hidden="true"
  ></div>
  {#if image?.mime === "image/gif"}
    <div class="image-node-picture-viewport" style:transform={`scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`} style:opacity={opacity}>
      <GifView
        {image}
        target={{ kind: "board", noteId }}
        hostSelected={selected}
        alt={name}
        class="image-node-gif"
        style="width:100%;height:100%;user-select:none"
        fit="fill"
      />
    </div>
  {:else if image && eraseCanvas}
    <div class="image-node-picture-viewport image-node-erasing" style:transform={`scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`} style:opacity={opacity} use:mountCanvas={eraseCanvas}></div>
  {:else if image}
    <div class="image-node-picture-viewport" style:transform={`scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`} style:opacity={opacity}>
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
  .image-node-erasing :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
    user-select: none;
  }

  .image-node-body {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: inherit;
  }

  .image-node-frame-outline {
    position: absolute;
    z-index: 2;
    inset: 1px;
    border: 1px dashed rgb(255 255 255 / 88%);
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 72%);
    opacity: 0;
    pointer-events: none;
    transition: opacity 100ms ease-out;
  }

  /* Only a fully erased picture gets a frame, so it can still be found and deleted. */
  .image-node-frame-outline.visible {
    opacity: 1;
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

  /* The GIF surface itself must receive hover and right-click (play mode, Stop/Play gif); only the
     pictures inside it ignore the pointer. */
  :global(.image-node-gif) {
    display: block;
    width: 100%;
    height: 100%;
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
