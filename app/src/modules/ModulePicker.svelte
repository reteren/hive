<script lang="ts">
  import ModuleChip from "./ModuleChip.svelte";
  import type { ModuleOption } from "./moduleLogic";

  let {
    title,
    mode,
    options,
    selected,
    onSelect,
    onClose,
    onRemove,
  }: {
    title: string;
    mode: "single" | "multiple";
    options: readonly ModuleOption[];
    selected: readonly string[];
    onSelect: (id: string) => void;
    onClose: () => void;
    onRemove?: () => void;
  } = $props();

</script>

<div
  class="module-picker"
  data-selection-ignore
  role="group"
  aria-label={title}
>
  <div class="module-picker-heading">
    <span>{title}</span>
    <button type="button" class="module-picker-close" aria-label="Close picker" onclick={onClose}>×</button>
  </div>
  <div class="module-picker-options">
    {#each options as option (option.id)}
      <ModuleChip
        label={option.label}
        color={option.color}
        iconPath={option.iconPath}
        pressed={selected.includes(option.id)}
        onClick={() => onSelect(option.id)}
      />
    {/each}
  </div>
  <div class="module-picker-actions">
    {#if onRemove}
      <button type="button" class="module-picker-remove" onclick={onRemove}>Remove</button>
    {/if}
    {#if mode === "multiple"}
      <button type="button" class="module-picker-done" onclick={onClose}>Done</button>
    {/if}
  </div>
</div>
