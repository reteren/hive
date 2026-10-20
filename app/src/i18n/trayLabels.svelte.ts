import { invoke, isTauri } from "@tauri-apps/api/core";
import { i18n, t } from "./i18n.svelte";

/** The tray menu is native; relabel it whenever the interface language changes. */
export function syncTrayLabels(): void {
  if (!isTauri()) return;
  $effect.root(() => {
    $effect(() => {
      void i18n.locale;
      invoke("tray_set_labels", { open: t("Open hive"), quickInput: t("Quick input"), quit: t("Quit") })
        .catch((error: unknown) => console.warn("Could not relabel the tray menu.", error));
    });
  });
}
