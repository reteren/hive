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

<div class="setting-row" data-quick-input-shortcut-setting>
  <span class="setting-copy">
    <span class="setting-title">Quick input shortcut</span>
    <span class="setting-description">Open quick input while hive is running in the tray.</span>
  </span>
  <button
    class="settings-button is-mono"
    class:is-primary={quickInputShortcut.capturing}
    type="button"
    aria-label={quickInputShortcut.capturing ? "Press a new quick input shortcut" : `Current shortcut: ${quickInputShortcut.value}. Change shortcut`}
    title={quickInputShortcut.capturing ? "Press a supported shortcut or Esc to cancel" : "Change global quick input shortcut"}
    onclick={() => void toggleCapture()}
  >
    {quickInputShortcut.capturing ? "Press keys…" : quickInputShortcut.value}
  </button>
</div>
{#if quickInputShortcut.error}
  <p class="settings-error" role="alert">{quickInputShortcut.error}</p>
{/if}
