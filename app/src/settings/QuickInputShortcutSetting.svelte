<script lang="ts">
  import { onMount } from "svelte";
  import { quickInputShortcut, setQuickInputShortcutError } from "./quickInputShortcut.svelte";
  import {
    restoreQuickInputShortcutAfterCapture,
    suspendQuickInputShortcutForCapture,
    updateQuickInputShortcut,
  } from "../quickInput/shortcutRegistration";
  import { installQuickInputShortcutCapture } from "../quickInput/keyCapture";
  import { t } from "../i18n/i18n.svelte";

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
    onUnsupportedKey: () => setQuickInputShortcutError(t("Use a supported key with Ctrl, Alt, or the Windows key.")),
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
    <span class="setting-title">{t("Quick input shortcut")}</span>
    <span class="setting-description">{t("Open quick input while hive is running in the tray.")}</span>
  </span>
  <button
    class="settings-button is-mono"
    class:is-primary={quickInputShortcut.capturing}
    type="button"
    aria-label={quickInputShortcut.capturing ? t("Press a new quick input shortcut") : t("Current shortcut: {value}. Change shortcut", { value: quickInputShortcut.value })}
    title={quickInputShortcut.capturing ? t("Press a supported shortcut or Esc to cancel") : t("Change global quick input shortcut")}
    onclick={() => void toggleCapture()}
  >
    {quickInputShortcut.capturing ? t("Press keys…") : quickInputShortcut.value}
  </button>
</div>
{#if quickInputShortcut.error}
  <p class="settings-error" role="alert">{quickInputShortcut.error}</p>
{/if}
