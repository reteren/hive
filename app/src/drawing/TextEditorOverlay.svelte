<script lang="ts">
  import { onMount, tick } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { worldToScreen } from "../board/cameraMath";
  import { drawingTools } from "./tools.svelte";
  import { cancelTextEditor, commitTextEditor, textEditor, updateTextEditor } from "./text.svelte";
  import { textScreenSizeAtZoom } from "./textLayout";

  let editor = $state<HTMLTextAreaElement | null>(null);
  let focusedSessionId = 0;
  let boardOriginX = $state(0);
  let boardOriginY = $state(0);
  const screenPoint = $derived(worldToScreen(camera, viewport, { x: textEditor.worldX, y: textEditor.worldY }));
  const fontSizeScreen = $derived(textScreenSizeAtZoom(textEditor.fontSizeWorld, camera.zoom));
  const lineHeight = $derived(Math.max(1, fontSizeScreen * 1.2));
  const lineCount = $derived(Math.max(1, textEditor.value.split("\n").length));
  const editorWidth = $derived(measureEditorWidth(textEditor.value, fontSizeScreen));

  onMount(() => {
    const board = document.querySelector<HTMLElement>(".board");
    if (!board) return;
    const updateOrigin = () => {
      const rect = board.getBoundingClientRect();
      boardOriginX = rect.left;
      boardOriginY = rect.top;
    };
    updateOrigin();
    const observer = new ResizeObserver(updateOrigin);
    observer.observe(board);
    window.addEventListener("resize", updateOrigin);
    window.addEventListener("scroll", updateOrigin, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOrigin);
      window.removeEventListener("scroll", updateOrigin, true);
    };
  });

  $effect(() => {
    if (!textEditor.active) return;
    const sessionId = textEditor.sessionId;
    void tick().then(() => {
      if (!textEditor.active || textEditor.sessionId !== sessionId || !editor) return;
      focusedSessionId = sessionId;
      editor.focus({ preventScroll: true });
      const end = editor.value.length;
      editor.setSelectionRange(end, end);
    });
  });

  onMount(() => {
    // Run before draw input's window capture handler so Escape cancels the text session ahead of
    // its mode-wide selection Escape handling.
    const onWindowKeydown = (event: KeyboardEvent) => {
      if (!textEditor.active) return;
      if (event.code === "Escape" && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelTextEditor(textEditor.sessionId);
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        commitTextEditor(textEditor.sessionId);
      }
    };
    window.addEventListener("keydown", onWindowKeydown, true);
    return () => window.removeEventListener("keydown", onWindowKeydown, true);
  });

  function measureEditorWidth(text: string, size: number): number {
    if (typeof document === "undefined") return Math.max(size, text.length * size * 0.6);
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return Math.max(size, text.length * size * 0.6);
    context.font = `${size}px system-ui, sans-serif`;
    const width = Math.max(0, ...text.split("\n").map((line) => context.measureText(line).width));
    return Math.max(size, Math.ceil(width + 8));
  }

  function onEditorBlur(): void {
    commitTextEditor(focusedSessionId);
  }
</script>

{#if textEditor.active}
  <div class="text-editor-overlay" aria-hidden="false">
    <textarea
      bind:this={editor}
      class="text-editor"
      data-draw-overlay-control
      aria-label="Text to draw"
      spellcheck="false"
      wrap="off"
      rows={lineCount}
      value={textEditor.value}
      style:left={`${boardOriginX + screenPoint.x}px`}
      style:top={`${boardOriginY + screenPoint.y}px`}
      style:width={`${editorWidth}px`}
      style:height={`${Math.ceil(lineHeight * lineCount + 4)}px`}
      style:font-size={`${fontSizeScreen}px`}
      style:line-height={`${lineHeight}px`}
      style:color={drawingTools.brush.color}
      style:opacity={drawingTools.brush.opacity}
      oninput={(event) => updateTextEditor(textEditor.sessionId, event.currentTarget.value)}
      onblur={onEditorBlur}
      onclick={(event) => event.stopPropagation()}
    ></textarea>
  </div>
{/if}

<style>
  .text-editor-overlay { position: fixed; z-index: 60; inset: 0; pointer-events: none; }
  .text-editor { position: absolute; box-sizing: content-box; min-width: 12px; margin: 0; padding: 0; border: 0; border-radius: 0; outline: 1px dashed rgb(255 255 255 / 55%); outline-offset: 1px; background: rgb(15 16 18 / 12%); font-family: system-ui, sans-serif; font-weight: 400; white-space: pre; overflow: hidden; resize: none; pointer-events: auto; }
  .text-editor:focus { outline-color: rgb(255 255 255 / 90%); }
</style>
