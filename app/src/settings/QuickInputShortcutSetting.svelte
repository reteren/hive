<script lang="ts">
  import { onMount } from "svelte";
  import { quickInputShortcut, setQuickInputShortcutError } from "./quickInputShortcut.svelte";
  import {
    restoreQuickInputShortcutAfterCapture,
    suspendQuickInputShortcutForCapture,
    updateQuickInputShortcut,
  } from "../quickInput/shortcutRegistration";
  import { installQuickInputShortcutCapture } from "../quickInput/keyCapture";

  onMount(() => installQuickInputShortcutCapture(window, {
    isCapturing: () => quickInputShortcut.capturing,
    onShortcut: (shortcut) => {
      quickInputShortcut.capturing = false;
      void updateQuickInputShortcut(shortcut);
    },
    onCancel: () => {
      quickInputShortcut.capturing = false;
      void restoreQuickInputShortcutAfterCapture();
    },
    onUnsupportedKey: () => setQuickInputShortcutError("Use a supported key with Ctrl, Alt, or the Windows key."),
  }));

  async function toggleCapture(): Promise<void> {
    if (quickInputShortcut.capturing) {
      quickInputShortcut.capturing = false;
      await restoreQuickInputShortcutAfterCapture();
      return;
    }

    quickInputShortcut.capturing = true;
    setQuickInputShortcutError("");
    try {
      await suspendQuickInputShortcutForCapture();
    } catch (error) {
      quickInputShortcut.capturing = false;
      setQuickInputShortcutError(error instanceof Error ? error.message : String(error));
    }
  }

</script>

<div class="quick-shortcut" data-quick-input-shortcut-setting>
  <div class="quick-shortcut__copy">
    <span>Quick input shortcut</span>
    <span class="quick-shortcut__description">Open quick input while hive is running in the tray.</span>
  </div>
  <button
    class="quick-shortcut__button"
    type="button"
    aria-label={quickInputShortcut.capturing ? "Press a new quick input shortcut" : `Current shortcut: ${quickInputShortcut.value}. Change shortcut`}
    title={quickInputShortcut.capturing ? "Press a supported shortcut or Esc to cancel" : "Change global quick input shortcut"}
    onclick={() => void toggleCapture()}
  >
    {quickInputShortcut.capturing ? "Press keys…" : quickInputShortcut.value}
  </button>
  {#if quickInputShortcut.error}
    <p class="quick-shortcut__error" role="alert">{quickInputShortcut.error}</p>
  {/if}
</div>

<style>
  .quick-shortcut {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 3px 12px;
    min-height: 38px;
    padding: 4px 2px;
    font-size: 11px;
  }

  .quick-shortcut__copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  .quick-shortcut__description {
    color: var(--text-dim);
    font-size: 9px;
    line-height: 1.35;
  }

  .quick-shortcut__button {
    min-width: 118px;
    min-height: 25px;
    padding: 3px 7px;
    border: 1px solid #484848;
    border-radius: 3px;
    background: #252525;
    color: var(--text);
    font: inherit;
    font-family: var(--mono-font);
    font-size: 10px;
    cursor: pointer;
  }

  .quick-shortcut__button:hover,
  .quick-shortcut__button:focus-visible {
    border-color: #806b2d;
    background: #343019;
    outline: none;
  }

  .quick-shortcut__error {
    grid-column: 1 / -1;
    margin: 0;
    color: #ffb0a6;
    font-size: 9px;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
</style>
