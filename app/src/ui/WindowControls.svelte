<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  // hive draws its own title bar (the native one ignores the theme): minimise, maximise/restore and
  // close live at the right end of the top bar. Close keeps the app's usual behaviour (hide to tray).
  const desktop = isTauri();
  let maximized = $state(false);

  onMount(() => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const sync = () => void appWindow.isMaximized().then((value) => (maximized = value)).catch(() => {});
    sync();
    void appWindow.onResized(sync).then((stop) => (unlisten = stop));
    return () => unlisten?.();
  });

  function minimize(): void {
    void getCurrentWindow().minimize();
  }

  function toggleMaximize(): void {
    void getCurrentWindow().toggleMaximize();
  }

  function close(): void {
    void getCurrentWindow().close();
  }
</script>

{#if desktop}
  <div class="window-controls" data-window-controls>
    <button type="button" class="window-button" aria-label="Minimize" title="Minimize" onclick={minimize}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 6h9" /></svg>
    </button>
    <button
      type="button"
      class="window-button"
      aria-label={maximized ? "Restore" : "Maximize"}
      title={maximized ? "Restore" : "Maximize"}
      onclick={toggleMaximize}
    >
      {#if maximized}
        <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="3.5" width="7" height="7" rx="0.5" /><path d="M3.5 3.5V2a0.5 0.5 0 0 1 0.5-0.5h6a0.5 0.5 0 0 1 0.5 0.5v6a0.5 0.5 0 0 1-0.5 0.5H8.5" /></svg>
      {:else}
        <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="0.5" /></svg>
      {/if}
    </button>
    <button type="button" class="window-button close" aria-label="Close" title="Close" onclick={close}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
    </button>
  </div>
{/if}

<style>
  .window-controls {
    display: flex;
    align-self: stretch;
    margin: -3px -5px -3px 6px;
  }

  .window-button {
    display: grid;
    width: 46px;
    padding: 0;
    place-items: center;
    border: 0;
    color: var(--icon, var(--text));
    background: transparent;
    cursor: default;
  }

  /* One 12×12 grid for all glyphs; the X uses equal diagonals (no crispEdges — it rounded the
     two strokes differently and made one line longer). */
  .window-button svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.15;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .window-button:hover {
    background: var(--bg-hover);
  }

  .window-button.close:hover {
    color: #ffffff;
    background: #c42b1c;
  }
</style>
