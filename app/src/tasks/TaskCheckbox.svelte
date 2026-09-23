<!-- Task completion checkbox in the note header (R3.1); renders nothing for non-task notes. -->
<script lang="ts">
  import type { Note } from "../model/note";

  let { note }: { note: Note } = $props();
</script>
