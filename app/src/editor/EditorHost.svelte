<script lang="ts">
  import { onMount } from "svelte";
  import { camera } from "../board/camera.svelte";
  import { history } from "../history/history.svelte";
  import type { Note } from "../model/note";
  import { consumePendingClick, detachEditor } from "./editorSession";
  import { breakTextEditGroup, createNoteEditor, observeHistoryBoundary } from "./createNoteEditor";
  import { closeHighlightPalette } from "./highlightPalette";
  import type { EditorView } from "@codemirror/view";

  let { note }: { note: Note } = $props();
  let host: HTMLDivElement;
  let editorView = $state.raw<EditorView | null>(null);

  onMount(() => {
    const view = createNoteEditor(host, note);
    editorView = view;
    const click = consumePendingClick(note.id);
    view.focus();

    const frame = requestAnimationFrame(() => {
      if (view.dom.isConnected) {
        const position = click ? view.posAtCoords(click) : null;
        view.dispatch({ selection: { anchor: position ?? view.state.doc.length } });
        view.focus();
      }
    });

    const onWheel = (event: WheelEvent) => {
      const scroller = view.scrollDOM;
      if (note.height !== null && scroller.scrollHeight > scroller.clientHeight + 1) {
        event.stopPropagation();
      }
    };
    view.dom.addEventListener("wheel", onWheel);

    return () => {
      cancelAnimationFrame(frame);
      view.dom.removeEventListener("wheel", onWheel);
      closeHighlightPalette(view);
      breakTextEditGroup();
      detachEditor(view);
      editorView = null;
    };
  });

  $effect(() => {
    const transform = `${camera.x}:${camera.y}:${camera.zoom}`;
    const view = editorView;
    if (!view) return;
    void transform;
    const frame = requestAnimationFrame(() => view.requestMeasure());
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    observeHistoryBoundary(history.entries, history.cursor);
  });
</script>

<div class="editor-host" bind:this={host}></div>

<style>
  .editor-host {
    min-width: 0;
  }
</style>
