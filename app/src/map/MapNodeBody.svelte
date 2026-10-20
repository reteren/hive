<script lang="ts">
  import type { Note } from "../model/note";
  import MapView from "./MapView.svelte";
  import { t } from "../i18n/i18n.svelte";

  let { note }: { note: Note } = $props();
</script>

<div class="map-node-body" data-map-node={note.id} data-map-node-body={note.id} data-selection-ignore aria-label={t("Map minimap for {name}", { name: note.name })}>
  <MapView variant="node" />
</div>

<style>
  .map-node-body { width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
  :global(.note-card[data-kind="map"] .note-content) { display: flex; min-height: 0; padding: 2px; overflow: hidden; }
</style>
