<script lang="ts">
  import { msg, t } from "../i18n/i18n.svelte";
  import { board } from "../model/board.svelte";
  import { lod, visible } from "../board/visibility.svelte";

  const twinTooltip = msg("Twin of an Inbox entry — interact to keep this one");

  $effect(() => {
    // Cards mount and unmount as the camera moves (culling, far-zoom shells): re-mark them each time.
    void visible.ids;
    void lod.tier;
    const twinIds = new Set(board.order.flatMap((id) => {
      const note = board.notes[id];
      return note?.inboxGroup ? [id] : [];
    }));
    const frame = requestAnimationFrame(() => {
      for (const root of document.querySelectorAll<HTMLElement>(".note-card[data-note-id]")) {
        const isTwin = twinIds.has(root.dataset.noteId ?? "");
        if (isTwin) {
          root.dataset.inboxTwin = "true";
          root.title = t(twinTooltip);
        } else if (root.dataset.inboxTwin === "true") {
          delete root.dataset.inboxTwin;
          if (root.title === t(twinTooltip)) root.removeAttribute("title");
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  });
</script>
