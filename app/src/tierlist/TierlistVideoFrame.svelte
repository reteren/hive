<script lang="ts">
  import { tierlistVideoFrame } from "./videoPreview";

  let { file, url, name, lines }: {
    file: string;
    url: string;
    name: string;
    lines: string[];
  } = $props();
  let frame = $state<HTMLCanvasElement | null>(null);

  $effect(() => {
    const request = tierlistVideoFrame(file, url);
    let active = true;
    void request.then((result) => {
      if (active) frame = result;
    });
    return () => { active = false; };
  });

  function drawFrame(element: HTMLCanvasElement, source: HTMLCanvasElement) {
    const draw = (frame: HTMLCanvasElement): void => {
      element.width = frame.width;
      element.height = frame.height;
      element.getContext("2d")?.drawImage(frame, 0, 0);
    };
    draw(source);
    return { update: draw };
  }
</script>

{#if frame}
  <canvas class="tier-card-image tier-video-frame" aria-label={name} title={name} use:drawFrame={frame}>{name}</canvas>
{:else}
  <div class="tier-video-fallback">
    <strong>{name}</strong>
    <span>{lines.join("\n") || "No text"}</span>
  </div>
{/if}

<style>
  .tier-video-frame { display: block; width: 100%; height: 54px; object-fit: contain; }
  .tier-video-fallback { display: flex; box-sizing: border-box; width: 100%; height: 56px; flex-direction: column; justify-content: center; gap: 2px; padding: 5px 16px 5px 7px; text-align: left; }
  .tier-video-fallback strong { overflow: hidden; color: #f0e4c9; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .tier-video-fallback span { display: -webkit-box; overflow: hidden; color: #bfc1c6; font-size: 10px; line-height: 1.25; white-space: pre-line; line-clamp: 3; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
</style>
