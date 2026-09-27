<script lang="ts">
  import { board } from "../model/board.svelte";

  const twinTooltip = "Twin of an Inbox entry — interact to keep this one";

  $effect(() => {
    const twinIds = new Set(board.order.flatMap((id) => {
      const note = board.notes[id];
      return note?.inboxGroup ? [id] : [];
    }));
    const frame = requestAnimationFrame(() => {
      for (const root of document.querySelectorAll<HTMLElement>(".note-card[data-note-id]")) {
        const isTwin = twinIds.has(root.dataset.noteId ?? "");
        if (isTwin) {
          root.dataset.inboxTwin = "true";
          root.title = twinTooltip;
        } else if (root.dataset.inboxTwin === "true") {
          delete root.dataset.inboxTwin;
          if (root.title === twinTooltip) root.removeAttribute("title");
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  });
</script>
