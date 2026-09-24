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
    deferred = false,
    description,
    confirmLabel,
    onConfirm,
    makeLocalLabel,
    onMakeLocal,
  }: {
    title: string;
    mode: "single" | "multiple";
    options: readonly ModuleOption[];
    selected: readonly string[];
    onSelect: (id: string) => void;
    onClose: () => void;
    onRemove?: () => void;
    deferred?: boolean;
    description?: string;
    confirmLabel?: string;
    onConfirm?: (id: string) => void;
    makeLocalLabel?: string;
    onMakeLocal?: (id: string) => void;
  } = $props();

  let draftId = $state<string | null>(null);

  $effect(() => {
    draftId = selected[0] ?? null;
  });

  function select(id: string): void {
    if (deferred) draftId = id;
    else onSelect(id);
  }

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
        pressed={deferred ? draftId === option.id : selected.includes(option.id)}
        onClick={() => select(option.id)}
      />
    {/each}
  </div>
  {#if description}
    <p class="module-picker-description">{description}</p>
  {/if}
  <div class="module-picker-actions">
    {#if onRemove}
      <button type="button" class="module-picker-remove" onclick={onRemove}>Remove</button>
    {/if}
    {#if mode === "multiple"}
      <button type="button" class="module-picker-done" onclick={onClose}>Done</button>
    {/if}
    {#if confirmLabel && onConfirm}
      <button
        type="button"
        class="module-picker-done"
        disabled={!draftId}
        onclick={() => draftId && onConfirm(draftId)}
      >{confirmLabel}</button>
    {/if}
    {#if makeLocalLabel && onMakeLocal}
      <button
        type="button"
        class="module-picker-done"
        disabled={!draftId}
        onclick={() => draftId && onMakeLocal(draftId)}
      >{makeLocalLabel}</button>
    {/if}
  </div>
</div>
