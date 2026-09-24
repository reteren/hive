<script lang="ts">
  import { onDestroy, onMount } from "svelte";
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
    floating = false,
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
    floating?: boolean;
  } = $props();

  let draftId = $state<string | null>(null);
  let pickerElement: HTMLDivElement;

  function placeFloatingPicker(): void {
    if (!floating || !pickerElement) return;
    const board = pickerElement.closest<HTMLElement>(".board");
    const host = pickerElement.parentElement;
    if (!board || !host) return;

    const boardRect = board.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const panel = document.querySelector<HTMLElement>(".right-panel");
    const panelLeft = panel && panel.getClientRects().length > 0
      ? panel.getBoundingClientRect().left
      : Number.POSITIVE_INFINITY;
    const visibleLeft = boardRect.left + 8;
    const visibleRight = Math.min(boardRect.right, panelLeft, window.innerWidth) - 8;
    const width = pickerElement.getBoundingClientRect().width;
    const maxLeft = Math.max(visibleLeft, visibleRight - width);
    const left = Math.max(visibleLeft, Math.min(hostRect.left - 5, maxLeft));
    const scale = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1;
    pickerElement.style.left = `${(left - hostRect.left) / scale}px`;
  }

  function onWindowPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("[data-module-picker], [data-module-trigger]")) return;
    onClose();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.code !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onClose();
  }

  onMount(() => {
    window.addEventListener("pointerdown", onWindowPointerDown, true);
    window.addEventListener("keydown", onWindowKeydown, true);
    if (floating) {
      placeFloatingPicker();
      window.addEventListener("resize", placeFloatingPicker);
    }
  });

  onDestroy(() => {
    window.removeEventListener("pointerdown", onWindowPointerDown, true);
    window.removeEventListener("keydown", onWindowKeydown, true);
    window.removeEventListener("resize", placeFloatingPicker);
  });

  $effect(() => {
    draftId = selected[0] ?? null;
  });

  function select(id: string): void {
    if (deferred) draftId = id;
    else onSelect(id);
  }

</script>

<div
  bind:this={pickerElement}
  class="module-picker"
  data-module-picker
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
