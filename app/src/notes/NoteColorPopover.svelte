<script lang="ts">
  import { camera, viewport } from "../board/camera.svelte";
  import { boardPopupStyle, dismissBoardPopup } from "../ui/boardAnchor";
  import HexColorPicker from "../color/HexColorPicker.svelte";
  import {
    closeNoteColorPopover,
    noteColorPopover,
    noteColorPopoverStart,
    previewNoteColor,
    resetNoteColorPopover,
  } from "./noteColor.svelte";

  let active = $derived(noteColorPopover.current);
  let title = $derived(active?.part === "accentColor" ? "Accent colour" : "Node colour");

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeNoteColorPopover(false);
    } else if (event.key === "Enter" && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      closeNoteColorPopover(true);
    }
  }
</script>

{#if active}
  <div
    class="note-color-popover"
    data-note-color-popover
    data-selection-ignore
    role="dialog"
    aria-label={title}
    tabindex="-1"
    style={boardPopupStyle(camera, viewport, { x: active.x, y: active.y }, active.zoomAtOpen)}
    use:dismissBoardPopup={{ close: () => closeNoteColorPopover(true), escape: false }}
    onkeydown={onKeyDown}
  >
    <span class="note-color-title">{title}{active.ids.length > 1 ? ` · ${active.ids.length} nodes` : ""}</span>
    <HexColorPicker
      value={active.value ?? noteColorPopoverStart(active)}
      label={title}
      oninput={previewNoteColor}
      onchange={previewNoteColor}
    />
    <div class="note-color-actions">
      <button type="button" class="reset" onclick={resetNoteColorPopover}>Reset</button>
      <button type="button" onclick={() => closeNoteColorPopover(false)}>Cancel</button>
      <button type="button" onclick={() => closeNoteColorPopover(true)}>Done</button>
    </div>
  </div>
{/if}

<style>
  .note-color-popover {
    position: absolute;
    z-index: 80;
    width: 210px;
    padding: 10px;
    border: 1px solid #555;
    border-radius: 5px;
    background: #292929;
    box-shadow: 0 5px 18px rgb(0 0 0 / 45%);
    color: #eee;
    font-size: 13px;
    pointer-events: auto;
    user-select: none;
  }

  .note-color-popover:focus { outline: none; }

  .note-color-title { display: block; margin-bottom: 8px; color: #bdbdbd; font-size: 11px; }

  .note-color-actions { display: flex; gap: 6px; margin-top: 9px; }

  .note-color-actions button {
    padding: 4px 8px;
    border: 1px solid #555;
    border-radius: 3px;
    background: #383838;
    color: #eee;
    cursor: pointer;
  }

  .note-color-actions button:hover { background: #484848; }

  .note-color-actions .reset { margin-right: auto; }
</style>
