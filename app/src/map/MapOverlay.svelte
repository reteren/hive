<script lang="ts">
  import { onMount } from "svelte";
  import MapView from "./MapView.svelte";
  import { mapOverlayState, closeMapOverlay } from "./commands";

  onMount(() => {
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.code !== "Escape" || !mapOverlayState.open || event.defaultPrevented) return;
      closeMapOverlay();
      event.preventDefault();
      event.stopPropagation();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  });

</script>

{#if mapOverlayState.open}
  <div
    class="map-backdrop"
    data-map-overlay
    data-map-overlay-open="true"
    data-selection-ignore
    role="presentation"
    onclick={(event) => { if (event.target === event.currentTarget) closeMapOverlay(); }}
  >
    <dialog open class="map-dialog" aria-modal="true" aria-label="Board map" data-selection-ignore>
      <header class="map-heading">
        <h2>Map</h2>
        <button type="button" class="map-close" aria-label="Close map" data-map-close onclick={closeMapOverlay}>×</button>
      </header>
      <div class="map-canvas">
        <MapView variant="overlay" />
      </div>
      <p class="map-help">Click or drag to move · Scroll to zoom · Esc to close</p>
    </dialog>
  </div>
{/if}

<style>
  .map-backdrop { position: absolute; z-index: 30; inset: 0; display: grid; place-items: center; padding: 18px; background: rgb(4 6 6 / 72%); }
  .map-dialog { position: relative; inset: auto; display: flex; width: min(70vw, 980px); height: min(70vh, 735px); min-width: min(340px, calc(100vw - 36px)); min-height: 250px; flex-direction: column; margin: 0; padding: 0; overflow: hidden; border: 1px solid #565447; border-radius: 7px; color: inherit; background: #202322; box-shadow: 0 18px 64px rgb(0 0 0 / 58%); }
  .map-heading { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; border-bottom: 1px solid #424540; }
  .map-heading h2 { margin: 0; color: #eee8cf; font-size: 13px; font-weight: 650; }
  .map-close { display: grid; width: 26px; height: 26px; place-items: center; padding: 0; border: 1px solid #514f47; border-radius: 4px; color: #ded9cb; background: #292b29; font: inherit; font-size: 20px; line-height: 1; cursor: pointer; }
  .map-close:hover { border-color: #b8a96d; color: #fff1b5; }
  .map-canvas { min-height: 0; flex: 1 1 auto; padding: 8px; }
  .map-canvas :global(.map-view) { border: 1px solid #3e4441; border-radius: 3px; }
  .map-help { flex: 0 0 auto; margin: 0; padding: 6px 10px 8px; color: #a9aaa1; font-size: 10px; text-align: center; }
  @media (max-width: 620px) { .map-backdrop { padding: 12px; } .map-dialog { width: calc(100vw - 24px); height: min(68vh, 580px); min-width: 0; } }
</style>
