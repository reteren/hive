<script lang="ts">
  import { formatKey } from "../commands/keys";
  import { getCommand } from "../commands/registry.svelte";
  import CommandButton from "./CommandButton.svelte";
  import SubtoolButton from "./SubtoolButton.svelte";
  import { isLineTool, tool, type LineToolId } from "../tools/tool.svelte";
  import { selectLineSubtool } from "../links/commands";
  import { DRAW_SUBTOOLS } from "../drawing/subtools";
  import { drawingTools } from "../drawing/tools.svelte";
  import { selectDrawingSubtool } from "../drawing/drawInput";
  import "../zones/commands";

  let moveCommand = $derived(getCommand("select.move"));
  let shapeCommand = $derived(getCommand("line.cycleShape"));
  let shapeLabel = $derived(tool.lineShape[0].toUpperCase() + tool.lineShape.slice(1));
  let selectHint = $derived(moveCommand?.keys.length
    ? `${moveCommand.keys.map(formatKey).join(", ")} — Move selection`
    : "Move selection");
  let lineSubtools = $derived<{ id: LineToolId; label: string; keys: string[] }[]>([
    { id: "line-strong", label: "Strong line", keys: getCommand("tool.lineStrong")?.keys ?? [] },
    { id: "line-weak", label: "Weak line", keys: getCommand("tool.lineWeak")?.keys ?? [] },
  ]);
</script>

<!-- Left vertical panel of working tools (R0.4). Line and Draw unfold their sub-tools while active. -->
<nav class="left-toolbar" aria-label="Navigation tools">
  <CommandButton commandId="view.home" />
  <CommandButton commandId="notes.createMenu" />
  <CommandButton commandId="tool.select" secondaryHint={selectHint} />
  <CommandButton
    commandId="tool.line"
    tooltipLabel={`Line · ${shapeLabel}`}
    tooltipBindings={shapeCommand?.keys ?? []}
    secondaryHint="Change line shape"
  >
    {#snippet icon()}
      {#if tool.lineShape === "base"}
        <path d="M4 15 C9 15 10 5 16 5" />
      {:else if tool.lineShape === "orthogonal"}
        <path d="M4 15 H10 V5 H16" />
      {:else if tool.lineShape === "wave"}
        <path d="M4 10 C6 4 8 4 10 10 C12 16 14 16 16 10" />
      {:else}
        <path d="M4 14 7 6 10 14 13 6 16 14" />
      {/if}
    {/snippet}
  </CommandButton>
  {#if isLineTool()}
    <div class="subtools" role="group" aria-label="Line kind">
      <span class="divider" aria-hidden="true"></span>
      {#each lineSubtools as option, index (option.id)}
        <SubtoolButton
          label={option.label}
          bindings={option.keys}
          active={tool.active === option.id}
          {index}
          onselect={() => selectLineSubtool(option.id)}
        >
          {#if option.id === "line-strong"}
            <path d="M4.5 15.5 15.5 4.5" stroke-width="1.8" />
          {:else}
            <path d="M4.5 15.5 15.5 4.5" stroke-width="1.8" stroke-dasharray="2.4 2.2" stroke-linecap="butt" />
          {/if}
        </SubtoolButton>
      {/each}
      <span class="divider end" aria-hidden="true"></span>
    </div>
  {/if}
  <CommandButton commandId="tool.zone" />
  <CommandButton commandId="tool.draw" />
  {#if tool.active === "draw"}
    <div class="subtools" role="group" aria-label="Drawing tool">
      <span class="divider" aria-hidden="true"></span>
      {#each DRAW_SUBTOOLS as option, index (option.id)}
        <SubtoolButton
          label={option.label}
          bindings={[option.key]}
          secondaryHint={option.hint}
          active={drawingTools.active === option.id}
          {index}
          onselect={() => selectDrawingSubtool(option.id)}
        >
          {#if option.id === "brush"}
            <path d="M16.6 3.4c-1.2.4-5.8 4.6-7.6 6.9l1.3 1.3c2.3-1.8 6.5-6.4 6.3-8.2z" />
            <path d="M8.3 11.1c-1.8 0-3 1.2-3 2.9 0 1-.6 1.8-1.7 2.2 2.6.9 5.6.2 5.9-2.5" />
          {:else if option.id === "eraser"}
            <path d="m3.6 12.6 7.6-7.8a1.4 1.4 0 0 1 2 0l3 3a1.4 1.4 0 0 1 0 2l-6.3 6.4H6.7z" />
            <path d="m7.6 8.6 5 5M10.2 16.2h6.4" />
          {:else if option.id === "fill"}
            <path d="m8.3 3.2 6.6 6.6-5.4 5.4a1.2 1.2 0 0 1-1.7 0l-4.9-4.9a1.2 1.2 0 0 1 0-1.7z" />
            <path d="M2.9 10h12M16.4 12.4c.9 1.3 1.4 2.2 1.4 2.8a1.4 1.4 0 0 1-2.8 0c0-.6.5-1.5 1.4-2.8z" />
          {:else if option.id === "select-rect"}
            <rect x="3.5" y="4.5" width="13" height="11" stroke-dasharray="2.2 1.8" />
          {:else if option.id === "select-lasso"}
            <path d="M8.2 14.4C4.9 13.8 3 12 3 9.8 3 6.6 6.2 4 10.2 4S17 6.4 17 9.3c0 2.7-2.9 4.9-6.6 5.1" stroke-dasharray="2.2 1.8" />
            <path d="M8.2 14.4c-.6 1-1.4 1.8-2.6 2.2M9.4 13.3a1.4 1.4 0 1 1-1.2 1.1" />
          {:else if option.id === "select-polygon"}
            <path d="M4 7.2 9.6 3.4l6.6 3.2-1.4 8.6-8.4 1.4z" stroke-dasharray="2.2 1.8" />
          {:else}
            <path d="M4.5 5V3.8h11V5M10 3.8v12.4M7.6 16.2h4.8" />
          {/if}
        </SubtoolButton>
      {/each}
      <span class="divider end" aria-hidden="true"></span>
    </div>
  {/if}
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
    overflow-y: auto;
    scrollbar-width: none;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
  }

  .subtools {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .divider {
    width: 18px;
    height: 1px;
    margin: 1px 0 3px;
    border-radius: 1px;
    background: var(--accent);
    animation: divider-in 160ms ease-out backwards;
  }

  .divider.end {
    margin: 3px 0 1px;
    animation-delay: 140ms;
  }

  @keyframes divider-in {
    from {
      transform: scaleX(0);
    }
  }

  :global(html[data-reduce-motion="true"]) .divider {
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .divider {
      animation: none;
    }
  }

  @media (max-width: 520px) {
    .left-toolbar {
      width: 32px;
      padding-inline: 2px;
    }
  }
</style>
