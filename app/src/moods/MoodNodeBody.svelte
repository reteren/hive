<!-- Shared standalone-module renderer; it keeps all module kinds visually consistent. -->
<script lang="ts">
  import type { Note } from "../model/note";
  import ModuleNodeBody from "../modules/ModuleNodeBody.svelte";

  let { note }: { note: Note } = $props();
</script>

<ModuleNodeBody {note} />
