<script lang="ts">
  import CommandButton from "./CommandButton.svelte";
</script>

<!-- Left vertical panel of working tools (R0.4). -->
<nav class="left-toolbar" aria-label="Navigation tools">
  <CommandButton commandId="view.home" />
  <CommandButton commandId="notes.createMenu" />
  <CommandButton commandId="select.move" />
</nav>

<style>
  .left-toolbar {
    display: flex;
    width: 34px;
    height: 100%;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 5px 3px;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
  }

  @media (max-width: 520px) {
    .left-toolbar {
      width: 32px;
      padding-inline: 2px;
    }
  }
</style>
