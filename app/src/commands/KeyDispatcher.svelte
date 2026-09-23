<script lang="ts">
  import { onMount } from "svelte";
  import { commands } from "./registry.svelte";
  import { findMatchingCommand } from "./keys";
  import { isTextEditingTarget } from "./focus";
  import { shouldRunOnKeydown } from "../search/keyboardRepeat";

  function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return target.closest(
      "button, a[href], input, textarea, select, summary, [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='switch'], [role='tab'], [role='menuitem'], [tabindex]:not([tabindex='-1'])",
    ) !== null;
  }

  onMount(() => {
    function handleKeydown(event: KeyboardEvent): void {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        isTextEditingTarget(event.target) ||
        isTextEditingTarget(document.activeElement)
      ) {
        return;
      }

      const focusedElement = event.target instanceof Element ? event.target : document.activeElement;
      if ((event.code === "Space" || event.code === "Enter") && isInteractiveTarget(focusedElement)) return;

      const command = findMatchingCommand(event, commands.values());
      if (!command) return;

      // Keep browser defaults suppressed while held; commands repeat only by explicit opt-in.
      event.preventDefault();
      if (shouldRunOnKeydown(command, event.repeat)) command.run();
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>
