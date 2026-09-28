import { initializeProjectPersistence } from "../project/persistence.svelte";
import { initializeViewSettingsPersistence } from "../settings/persistence.svelte";
import { startTimeRuntime } from "./runtime.svelte";

// This module is imported only by the main window entrypoint, never quick-input.
void initializeViewSettingsPersistence()
  .then(() => initializeProjectPersistence())
  .then(() => startTimeRuntime())
  .catch((error: unknown) => {
    console.error("Could not start the Time runtime.", error);
  });
