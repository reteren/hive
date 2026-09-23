<script lang="ts">
  import CommandButton from "./CommandButton.svelte";
</script>

<!-- Right-hand display settings (R0.4). -->
<aside class="right-panel" aria-label="Display panel">
  <header class="panel-heading">
    <h2>Display</h2>
    <CommandButton commandId="ui.toggleRightPanel" />
  </header>
  <div class="display-commands">
    <CommandButton commandId="grid.toggleShow" showLabel />
    <CommandButton commandId="grid.toggleSnap" showLabel />
  </div>
  <section class="grid-step-commands" aria-label="Grid step commands">
    <h3>Grid step</h3>
    <CommandButton commandId="grid.stepDown" showLabel />
    <CommandButton commandId="grid.stepUp" showLabel />
  </section>
</aside>

<style>
  .right-panel {
    width: 186px;
    height: 100%;
    overflow: auto;
    padding: 4px 6px;
    background: var(--bg-panel);
    border-left: 1px solid var(--border);
  }

  .panel-heading {
    display: flex;
    min-height: 30px;
    align-items: center;
    justify-content: space-between;
    padding-left: 4px;
    border-bottom: 1px solid #3b3b3b;
  }

  h2 {
    margin: 0;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
  }

  .display-commands {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-top: 6px;
  }

  .grid-step-commands {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 10px;
    padding-top: 7px;
    border-top: 1px solid #3b3b3b;
  }

  h3 {
    margin: 0 4px 2px;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  @media (max-width: 520px) {
    .right-panel {
      width: 158px;
      padding-inline: 4px;
    }
  }

  @media (max-width: 420px) {
    .right-panel {
      width: min(164px, calc(100vw - 44px));
      padding: 4px;
    }
  }
</style>
