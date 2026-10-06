<script lang="ts">
  import { LIST_ICONS, type ListRowKind } from "./icons";
  let { kind }: { kind: ListRowKind } = $props();
  let icon = $derived(LIST_ICONS[kind]);
</script>

<span class="list-kind-icon" data-list-kind-icon={kind} title={icon.label} role="img" aria-label={icon.label} style:color={icon.color}>
  <svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="var(--icon)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#each icon.paths as path}<path d={path}></path>{/each}
  </svg>
</span>

<style>
  .list-kind-icon { display: inline-flex; flex: none; width: 18px; height: 20px; align-items: center; justify-content: center; }
</style>
