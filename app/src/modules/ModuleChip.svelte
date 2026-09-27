<script lang="ts">
  import { onDestroy } from "svelte";
  import { board } from "../model/board.svelte";
  import { noteBounds } from "../notes/layout.svelte";
  import { extractModuleFromNote, worldPointFromClient } from "./moduleActions.svelte";

  let {
    label,
    color,
    iconPath,
    rainbow = false,
    pressed,
    interactive = true,
    selectionIgnore = true,
    linked = false,
    onClick,
    onDoubleClick,
    onPointerDown,
    dragKind,
    dragValue,
    dragNoteId,
  }: {
    label: string;
    color: string;
    iconPath?: string;
    rainbow?: boolean;
    pressed?: boolean;
    interactive?: boolean;
    selectionIgnore?: boolean;
    linked?: boolean;
    onClick?: () => void;
    onDoubleClick?: () => void;
    onPointerDown?: (event: PointerEvent) => void;
    dragKind?: "importance" | "purpose" | "mood" | "markas";
    dragValue?: string;
    dragNoteId?: string;
  } = $props();

  let gesture: { pointerId: number; startX: number; startY: number; dragging: boolean } | null = null;
  let previousUserSelect: { root: string; body: string } | null = null;
  let suppressNextClick = false;
  let suppressClickTimer: ReturnType<typeof setTimeout> | undefined;

  function handleDoubleClick(event: MouseEvent): void {
    event.stopPropagation();
    onDoubleClick?.();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.code !== "Enter" && event.code !== "Space") return;
    event.preventDefault();
    event.stopPropagation();
    onDoubleClick?.();
  }

  function beginDrag(event: PointerEvent): void {
    event.stopPropagation();
    if (dragKind && dragValue && dragNoteId && event.button === 0 && !gesture) {
      // Keep the embedded editor and browser text-selection gesture out of chip drags.
      event.preventDefault();
      gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false };
      window.addEventListener("pointermove", moveDrag, true);
      window.addEventListener("pointerup", finishDrag, true);
      window.addEventListener("pointercancel", cancelDrag, true);
    }
    onPointerDown?.(event);
  }

  function moveDrag(event: PointerEvent): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 6) {
      gesture.dragging = true;
      previousUserSelect = {
        root: document.documentElement.style.userSelect,
        body: document.body.style.userSelect,
      };
      document.documentElement.style.userSelect = "none";
      document.body.style.userSelect = "none";
    }
    if (gesture.dragging) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function finishDrag(event: PointerEvent): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const wasDragging = gesture.dragging;
    cleanupDrag();
    if (!wasDragging || !dragKind || !dragValue || !dragNoteId) return;

    event.preventDefault();
    event.stopPropagation();
    suppressClickAfterDrag();
    const point = worldPointFromClient(event.clientX, event.clientY);
    if (!point) return;
    const source = board.notes[dragNoteId];
    const bounds = source ? noteBounds(source) : null;
    if (bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y && point.y <= bounds.y + bounds.height) return;
    extractModuleFromNote(
      dragNoteId,
      dragKind,
      dragValue,
      point,
    );
  }

  function cancelDrag(event: PointerEvent): void {
    if (gesture?.pointerId === event.pointerId) cleanupDrag();
  }

  function cleanupDrag(): void {
    gesture = null;
    window.removeEventListener("pointermove", moveDrag, true);
    window.removeEventListener("pointerup", finishDrag, true);
    window.removeEventListener("pointercancel", cancelDrag, true);
    if (previousUserSelect) {
      document.documentElement.style.userSelect = previousUserSelect.root;
      document.body.style.userSelect = previousUserSelect.body;
      previousUserSelect = null;
    }
  }

  function suppressClickAfterDrag(): void {
    suppressNextClick = true;
    if (suppressClickTimer !== undefined) clearTimeout(suppressClickTimer);
    suppressClickTimer = setTimeout(() => {
      suppressNextClick = false;
      suppressClickTimer = undefined;
    }, 120);
  }

  function handleClick(): void {
    if (suppressNextClick) {
      suppressNextClick = false;
      if (suppressClickTimer !== undefined) clearTimeout(suppressClickTimer);
      suppressClickTimer = undefined;
      return;
    }
    onClick?.();
  }

  onDestroy(() => {
    cleanupDrag();
    if (suppressClickTimer !== undefined) clearTimeout(suppressClickTimer);
  });
</script>

{#if interactive}
  <button
    type="button"
    class="module-chip"
    class:pressed={pressed}
    class:rainbow
    data-selection-ignore={selectionIgnore ? "" : undefined}
    data-module-trigger
    data-module-kind={dragKind}
    data-module-value={dragValue}
    aria-pressed={pressed}
    style={`--module-color: ${color}`}
    onclick={handleClick}
    ondblclick={handleDoubleClick}
    onpointerdown={beginDrag}
  >
    {#if iconPath}
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={iconPath} />
      </svg>
    {:else}
      <span class="module-chip-dot" class:rainbow aria-hidden="true"></span>
    {/if}
    <span>{label}</span>
    {#if linked}
      <span class="module-chip-linked-mark" aria-label="Linked">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 7.5 7.8 4.2M6.2 3.2l.7-.7a2.1 2.1 0 0 1 3 3l-.7.7M5.8 8.8l-.7.7a2.1 2.1 0 0 1-3-3l.7-.7" /></svg>
      </span>
    {/if}
  </button>
{:else}
  {#if onDoubleClick}
    <div
      class="module-chip module-chip-display"
      class:pressed={pressed}
      class:rainbow
      data-selection-ignore={selectionIgnore ? "" : undefined}
      data-module-trigger
      role="button"
      tabindex="0"
      style={`--module-color: ${color}`}
      ondblclick={handleDoubleClick}
      onkeydown={handleKeydown}
    >
      {#if iconPath}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d={iconPath} /></svg>
      {:else}
        <span class="module-chip-dot" class:rainbow aria-hidden="true"></span>
      {/if}
      <span>{label}</span>
    </div>
  {:else}
    <span
      class="module-chip module-chip-display"
      class:pressed={pressed}
      class:rainbow
      data-selection-ignore={selectionIgnore ? "" : undefined}
      data-module-trigger
      style={`--module-color: ${color}`}
    >
      {#if iconPath}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d={iconPath} /></svg>
      {:else}
        <span class="module-chip-dot" class:rainbow aria-hidden="true"></span>
      {/if}
      <span>{label}</span>
      {#if linked}
        <span class="module-chip-linked-mark" aria-hidden="true">
          <svg viewBox="0 0 12 12"><path d="M4.5 7.5 7.8 4.2M6.2 3.2l.7-.7a2.1 2.1 0 0 1 3 3l-.7.7M5.8 8.8l-.7.7a2.1 2.1 0 0 1-3-3l.7-.7" /></svg>
        </span>
      {/if}
    </span>
  {/if}
{/if}
