<script lang="ts">
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
    dragKind?: "importance" | "purpose";
    dragValue?: string;
  } = $props();

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
</script>

{#if interactive}
  <button
    type="button"
    class="module-chip"
    class:pressed={pressed}
    class:rainbow
    data-selection-ignore={selectionIgnore ? "" : undefined}
    data-module-kind={dragKind}
    data-module-value={dragValue}
    aria-pressed={pressed}
    style={`--module-color: ${color}`}
    onclick={onClick}
    ondblclick={handleDoubleClick}
    onpointerdown={(event) => {
      event.stopPropagation();
      onPointerDown?.(event);
    }}
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
      role="button"
      tabindex="0"
      style={`--module-color: ${color}`}
      ondblclick={handleDoubleClick}
      onkeydown={handleKeydown}
    >
      {#if iconPath}
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d={iconPath} />
        </svg>
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
      style={`--module-color: ${color}`}
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
        <span class="module-chip-linked-mark" aria-hidden="true">
          <svg viewBox="0 0 12 12"><path d="M4.5 7.5 7.8 4.2M6.2 3.2l.7-.7a2.1 2.1 0 0 1 3 3l-.7.7M5.8 8.8l-.7.7a2.1 2.1 0 0 1-3-3l.7-.7" /></svg>
        </span>
      {/if}
    </span>
  {/if}
{/if}
