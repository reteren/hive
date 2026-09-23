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
    border: 1px solid #5a4a1d;
    border-radius: 3px;
    background: #292516;
    color: #f1d98e;
    font-size: 10px;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
    animation: toast-lifetime 2s ease both;
  }

  .history-toast.muted {
    border-color: #383838;
    background: #202020;
    color: var(--text-dim);
  }

  @keyframes toast-lifetime {
    0% { opacity: 0; transform: translateY(4px); }
    8% { opacity: 1; transform: translateY(0); }
    72% { opacity: 1; }
    100% { opacity: 0; }
  }
</style>
