<script lang="ts">
  import { historyFeedback } from "../history/history.svelte";
</script>

{#if historyFeedback.current}
  {#key historyFeedback.current.id}
    <div
      class="history-toast"
      class:muted={historyFeedback.current.tone === "muted"}
      role="status"
      aria-live="polite"
    >
      {historyFeedback.current.message}
    </div>
  {/key}
{/if}

<style>
  .history-toast {
    max-width: min(340px, 100%);
    padding: 6px 9px;
    overflow: hidden;
    border: 1px solid rgba(var(--accent-rgb), 0.45);
    border-radius: 3px;
    background: rgba(var(--accent-rgb), 0.12);
    color: var(--accent);
    font-size: 10px;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
    animation: toast-lifetime 2s ease both;
  }

  .history-toast.muted {
    border-color: var(--border);
    background: var(--bg-panel);
    color: var(--text-dim);
  }

  @keyframes toast-lifetime {
    0% { opacity: 0; transform: translateY(4px); }
    8% { opacity: 1; transform: translateY(0); }
    72% { opacity: 1; }
    100% { opacity: 0; }
  }
</style>
