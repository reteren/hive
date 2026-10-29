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

  /* Floating panels styled like the app's right-click menus. */
  .attention-bar, .attention-summary {
    position: absolute;
    left: 4px;
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: calc(100% - 8px);
    padding: 3px;
    border: 1px solid #4c4c4c;
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 5px 16px rgb(0 0 0 / 45%);
    color: var(--text);
    font-size: 11px;
  }

  .attention-bar { top: 4px; flex-wrap: wrap; }

  .attention-toggle, .attention-periods button {
    display: flex;
    align-items: center;
    min-height: 22px;
    padding: 3px 7px;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    user-select: none;
  }

  .attention-toggle { gap: 6px; }
  .attention-toggle input { width: 12px; height: 12px; margin: 0; accent-color: var(--accent); cursor: pointer; }
  .attention-toggle:hover, .attention-periods button:hover { background: var(--bg-hover); }
  .attention-periods { display: flex; align-items: center; gap: 2px; }
  .attention-periods::before { content: ""; width: 1px; height: 14px; margin: 0 3px; background: #474747; }
  .attention-periods button { color: var(--text-dim); }
  .attention-periods button.active { background: var(--bg-hover); color: var(--text); }

  .attention-summary { bottom: 4px; padding: 4px 8px; pointer-events: none; }
</style>
