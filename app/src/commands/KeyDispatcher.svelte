<script lang="ts">
  import { onMount } from "svelte";
  import { commands } from "./registry.svelte";
  import { findMatchingCommand } from "./keys";
  import { isTextEditingTarget } from "./focus";

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

      // Keep browser defaults suppressed for a held toggle key, but run its action once.
      event.preventDefault();
      if (!event.repeat || !command.isActive) command.run();
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>
