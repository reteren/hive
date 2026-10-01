import { getCommand } from "./registry.svelte";
import { formatKey } from "./keys";

/** Current user-facing key hint for a command, with menu-friendly Del spelling. */
export function menuShortcutLabel(commandId: string): string {
  return (getCommand(commandId)?.keys ?? [])
    .map((binding) => formatKey(binding).replace(/^Delete$/, "Del"))
    .join(" / ");
}
