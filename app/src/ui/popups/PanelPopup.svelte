<script lang="ts">
  import type { Snippet } from "svelte";
  import { closePanelPopup, type PanelPopupId } from "./panelPopupState.svelte";

  let { id, title, children } = $props<{
    id: PanelPopupId;
    title: string;
    children: Snippet;
  }>();

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closePanelPopup();
  }
</script>

<div class="panel-popup-layer" data-selection-ignore role="presentation" onkeydown={handleKeydown}>
  <button class="panel-popup-backdrop" type="button" aria-label={`Close ${title}`} onclick={() => closePanelPopup()}></button>
  <div class="panel-popup-frame">
    <div class="panel-popup-surface" data-panel-popup={id} role="group" aria-label={title} tabindex="-1">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .panel-popup-layer {
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: grid;
    align-content: start;
    justify-items: center;
    padding: min(15vh, 110px) 14px 14px;
  }

  .panel-popup-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    background: rgb(0 0 0 / 48%);
    cursor: default;
  }

  .panel-popup-frame {
    position: relative;
    display: flex;
    width: min(620px, 100%);
    max-height: min(560px, 78vh);
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #4d4d4d;
    border-radius: 5px;
    background: var(--bg-panel);
    box-shadow: 0 14px 40px rgb(0 0 0 / 60%);
    color: var(--text);
  }

  .panel-popup-surface {
    display: flex;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-popup-surface :global(.popup-panel) {
    position: relative;
    inset: auto;
    left: auto;
    right: auto;
    top: auto;
    width: 100%;
    max-width: none;
    max-height: min(560px, 78vh);
    margin: 0;
    flex: 1 1 auto;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  @media (max-width: 460px) {
    .panel-popup-layer {
      padding: 9vh 8px 8px;
    }
  }
</style>
