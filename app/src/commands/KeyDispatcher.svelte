<script lang="ts">
  import { onMount } from "svelte";
  import { commands } from "./registry.svelte";
  import { matchesKey } from "./keys";

  function isTextEntryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    if (target.closest("input, textarea, select")) return true;

    const editable = target.closest("[contenteditable]");
    return !!editable && editable.getAttribute("contenteditable")?.toLowerCase() !== "false";
  }

  onMount(() => {
    function handleKeydown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || isTextEntryTarget(event.target)) {
        return;
      }

      for (const command of commands.values()) {
        if (!command.keys.some((binding) => matchesKey(event, binding))) continue;

        // Keep browser defaults suppressed for a held toggle key, but run its action once.
        event.preventDefault();
        if (!event.repeat || !command.isActive) command.run();
        return;
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>
