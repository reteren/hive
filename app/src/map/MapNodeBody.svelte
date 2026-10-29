<script lang="ts">
  import type { Note } from "../model/note";
  import MapView from "./MapView.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { ATTENTION_PERIODS, OUTSIDE_ZONES, attentionPercent, summarizeAttention, type AttentionPeriod } from "../attention/logic";
  import { attention, attentionLog, attentionMaps, setAttentionMap } from "../attention/tracker.svelte";

  let { note }: { note: Note } = $props();
  let period = $derived(attentionMaps.byId[note.id] ?? null);
  let summary = $derived.by(() => {
    if (!period) return null;
    void attention.revision;
    return summarizeAttention(attentionLog(), period, new Date());
  });

  const PERIOD_LABELS: Record<AttentionPeriod, string> = { today: "Today", week: "7 days", month: "30 days", all: "All time" };

  function duration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return t("under a minute");
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? t("{hours} h {minutes} min", { hours, minutes: minutes % 60 }) : t("{minutes} min", { minutes });
  }
</script>

<div class="map-node-body" data-map-node={note.id} data-map-node-body={note.id} data-selection-ignore aria-label={t("Map minimap for {name}", { name: note.name })}>
  <MapView variant="node" attention={summary} />
  <div class="attention-bar" data-attention-controls>
    <label class="attention-toggle" title={t("Show where you spend your time on the board")}>
      <input
        type="checkbox"
        checked={period !== null}
        data-attention-toggle
        onchange={(event) => setAttentionMap(note.id, event.currentTarget.checked ? "week" : null)}
      />
      <span>{t("Attention")}</span>
    </label>
    {#if period}
      <div class="attention-periods" role="radiogroup" aria-label={t("Attention period")}>
        {#each ATTENTION_PERIODS as option (option)}
          <button
            type="button"
            role="radio"
            aria-checked={period === option}
            class:active={period === option}
            data-attention-period={option}
            onclick={() => setAttentionMap(note.id, option)}
          >{t(PERIOD_LABELS[option])}</button>
        {/each}
      </div>
    {/if}
  </div>
  {#if summary}
    <div class="attention-summary" data-attention-summary>
      {#if summary.total > 0}
        {t("Total {time}", { time: duration(summary.total) })} · {t("outside zones {percent}%", { percent: attentionPercent(summary.zones[OUTSIDE_ZONES] ?? 0, summary.total) })}
      {:else}
        {t("No time counted yet: it adds up while you work in hive")}
      {/if}
    </div>
  {/if}
</div>

<style>
  .map-node-body { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
  :global(.note-card[data-kind="map"] .note-content) { display: flex; min-height: 0; padding: 2px; overflow: hidden; }

  .attention-bar {
    position: absolute;
    top: 4px;
    left: 4px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    max-width: calc(100% - 8px);
    pointer-events: none;
  }

  .attention-toggle, .attention-periods {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: color-mix(in srgb, var(--bg-panel) 88%, transparent);
    pointer-events: auto;
  }

  .attention-toggle { gap: 4px; padding: 2px 6px 2px 4px; color: var(--text); font-size: 10px; cursor: pointer; user-select: none; }
  .attention-toggle input { width: 11px; height: 11px; margin: 0; accent-color: var(--accent); cursor: pointer; }
  .attention-periods { padding: 1px; gap: 1px; }

  .attention-periods button {
    padding: 1px 5px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .attention-periods button:hover { color: var(--text); }
  .attention-periods button.active { background: rgba(var(--accent-rgb), 0.18); color: var(--accent); }

  .attention-summary {
    position: absolute;
    left: 4px;
    bottom: 4px;
    max-width: calc(100% - 8px);
    padding: 2px 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--bg-panel) 88%, transparent);
    color: var(--text-dim);
    font-size: 10px;
    pointer-events: none;
  }
</style>
