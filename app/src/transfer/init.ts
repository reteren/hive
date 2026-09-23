import { startTransferSync } from "./sync.svelte";

/** Starts live Text → Task transfer syncing (R3.7), once the project store is available. */
let initialized = false;

export function initializeTransfer(): void {
  if (initialized) return;
  initialized = true;
  startTransferSync();
}
