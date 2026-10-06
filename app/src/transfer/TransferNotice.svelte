<!-- Confirmation / notices for Text → Task transfer (R3.7). -->
<script lang="ts">
  import { board } from "../model/board.svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { worldToScreen } from "../board/cameraMath";
  import { noteBounds } from "../notes/layout.svelte";
  import {
    dismissTransferWarning,
    keepTaskText,
    replaceTransferText,
    transferUi,
  } from "./sync.svelte";

  type VisualItem =
    | { key: string; kind: "prompt"; targetId: string; linkId: string; sourceName: string; targetName: string }
    | { key: string; kind: "warning" | "inactive"; targetId: string; message: string };

  let items = $derived.by((): VisualItem[] => ([
    ...transferUi.prompts.map((prompt) => ({
      key: `prompt:${prompt.linkId}`,
      kind: "prompt" as const,
      targetId: prompt.targetId,
      linkId: prompt.linkId,
      sourceName: prompt.sourceName,
      targetName: prompt.targetName,
    })),
    ...transferUi.warnings.map((warning) => ({
      key: `warning:${warning.id}`,
      kind: "warning" as const,
      targetId: warning.targetId,
      message: warning.message,
    })),
    ...transferUi.inactive.map((notice) => ({
      key: `inactive:${notice.id}`,
      kind: "inactive" as const,
      targetId: notice.targetId,
      message: notice.message,
    })),
  ]).filter((item) => Boolean(board.notes[item.targetId])));

  function positionFor(item: VisualItem): { left: number; top: number } {
    const note = board.notes[item.targetId];
    if (!note) return { left: 8, top: 8 };
    const bounds = noteBounds(note);
    const screen = worldToScreen(camera, viewport, {
      x: bounds.x + bounds.width,
      y: bounds.y,
    });
    const sameTarget = items.filter((candidate) => candidate.targetId === item.targetId);
    const index = Math.max(0, sameTarget.findIndex((candidate) => candidate.key === item.key));
    const width = item.kind === "prompt" ? 328 : 260;
    const left = Math.max(8, Math.min(screen.x + 8, viewport.width - width - 8));
    const top = Math.max(8, Math.min(screen.y + index * 82, viewport.height - 88));
    return { left, top };
  }
</script>

{#if items.length > 0}
  <div class="transfer-layer" data-selection-ignore aria-label="Text transfer notices">
    {#each items as item (item.key)}
      {@const position = positionFor(item)}
      {#if item.kind === "prompt"}
        <section
          class="transfer-card confirmation"
          role="group"
          aria-label="Text transfer confirmation"
          style:left={`${position.left}px`}
          style:top={`${position.top}px`}
        >
          <p>Replace text of <strong>{item.targetName}</strong> with text of <strong>{item.sourceName}</strong>?</p>
          <div class="actions">
            <button type="button" class="replace" onclick={() => replaceTransferText(item.linkId)}>Replace</button>
            <button type="button" onclick={() => keepTaskText(item.linkId)}>Keep</button>
          </div>
        </section>
      {:else}
        <section
          class="transfer-card notice"
          class:warning={item.kind === "warning"}
          role="status"
          aria-live="polite"
          style:left={`${position.left}px`}
          style:top={`${position.top}px`}
        >
          <span>{item.message}</span>
          {#if item.kind === "warning"}
            <button type="button" aria-label="Dismiss text transfer warning" onclick={() => dismissTransferWarning(item.targetId)}>×</button>
          {/if}
        </section>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .transfer-layer {
    position: absolute;
    z-index: 26;
    inset: 0;
    pointer-events: none;
  }

  .transfer-card {
    position: absolute;
    display: flex;
    width: min(328px, calc(100% - 16px));
    box-sizing: border-box;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 8px;
    border: 1px solid #786532;
    border-radius: 4px;
    background: #25231b;
    box-shadow: 0 5px 16px rgb(0 0 0 / 48%);
    color: var(--text);
    font-size: 10px;
    line-height: 1.35;
    pointer-events: auto;
  }

  .confirmation {
    flex-direction: column;
  }

  p {
    margin: 0;
  }

  strong {
    color: var(--accent);
    font-weight: 650;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 5px;
    width: 100%;
  }

  button {
    min-height: 24px;
    padding: 3px 8px;
    border: 1px solid #4b4b4b;
    border-radius: 3px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  button:hover {
    border-color: #777;
    background: var(--bg-hover);
  }

  button.replace {
    border-color: rgba(var(--accent-rgb), 0.45);
    background: rgba(var(--accent-rgb), 0.16);
    color: var(--accent);
  }

  .notice {
    align-items: center;
    width: min(260px, calc(100% - 16px));
    max-width: 260px;
    border-color: #4a4a4a;
    background: var(--bg-panel);
    color: var(--text-dim);
  }

  .notice.warning {
    border-color: #806b2d;
    background: #343019;
    color: #fff0be;
  }

  .notice > span {
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .notice button {
    flex: 0 0 auto;
    min-width: 22px;
    padding: 1px 5px;
    border-color: transparent;
    background: transparent;
    font-size: 14px;
  }
</style>
