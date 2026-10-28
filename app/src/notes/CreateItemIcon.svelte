<script lang="ts">
  import type { CreateCategoryId, CreateItemId } from "./createMenuCatalog";

  /** 16×16 line icons for the Q menu items and category tabs; colour comes from the theme icon colour. */
  let { id }: { id: CreateItemId | CreateCategoryId } = $props();
</script>

<svg class="create-icon" data-icon={id} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
  {#if id === "note"}
    <path d="M3.5 2.5h6.5l2.5 2.5v8.5h-9z" /><path d="M10 2.5V5h2.5M5.5 8h5M5.5 10.5h4" />
  {:else if id === "task"}
    <circle cx="8" cy="8" r="5.6" />
  {:else if id === "tasks"}
    <circle cx="8" cy="8" r="5.6" /><path d="m5.6 8.1 1.7 1.7 3.2-3.4" />
  {:else if id === "list"}
    <path d="M6.5 4.5h6M6.5 8h6M6.5 11.5h6" /><circle class="dot" cx="3.8" cy="4.5" r=".9" /><circle class="dot" cx="3.8" cy="8" r=".9" /><circle class="dot" cx="3.8" cy="11.5" r=".9" />
  {:else if id === "inbox"}
    <path d="M2.5 9 4.3 3.5h7.4L13.5 9v3.5h-11z" /><path d="M2.5 9h3l1 1.6h3l1-1.6h3" />
  {:else if id === "goal"}
    <circle cx="8" cy="8" r="5.6" /><circle cx="8" cy="8" r="3" /><circle class="dot" cx="8" cy="8" r=".9" />
  {:else if id === "progress"}
    <rect x="2" y="6" width="12" height="4" rx="1.2" /><rect class="fill" x="2" y="6" width="7" height="4" rx="1.2" />
  {:else if id === "pro"}
    <rect class="pro" x="2.5" y="2.5" width="11" height="11" rx="2" /><path class="pro" d="M8 5.2v5.6M5.2 8h5.6" />
  {:else if id === "con"}
    <rect class="con" x="2.5" y="2.5" width="11" height="11" rx="2" /><path class="con" d="M5.2 8h5.6" />
  {:else if id === "importance"}
    <circle class="fill glow" cx="8" cy="8" r="3.4" />
  {:else if id === "purpose"}
    <path d="M8 2.5 13.5 8 8 13.5 2.5 8zM8 5.5v5M5.5 8h5" />
  {:else if id === "mood"}
    <circle class="mood" cx="8" cy="8" r="4.2" />
  {:else if id === "markas" || id === "marks"}
    {#if id === "marks"}
      <path d="M4 13.5V2.8M4 3h7.5l-1.6 2.6 1.6 2.6H4" />
    {:else}
      <path d="M2.5 3.5v4.3l6 6 5-5-6-6H3.5zM5.6 6.1h.1" />
    {/if}
  {:else if id === "time"}
    <circle cx="8" cy="8" r="5.6" /><path d="M8 4.8V8l2.2 1.4" />
  {:else if id === "calendar"}
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  {:else if id === "message"}
    <path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" />
  {:else if id === "image" || id === "media"}
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="m3 12 3.5-4 2.5 2.5L11 8.5l2.5 3" /><circle class="dot" cx="10.6" cy="5.8" r=".9" />
  {:else if id === "pdf"}
    <path d="M3.5 2.5h6.5l2.5 2.5v8.5h-9z" /><path d="M10 2.5V5h2.5" /><path class="accent" d="M5.5 9.5h5M5.5 11.5h3" />
  {:else if id === "format"}
    <path d="M3.5 2.5h6.5l2.5 2.5v8.5h-9z" /><path d="m6.6 7.5-1.5 1.5 1.5 1.5M9.4 7.5l1.5 1.5-1.5 1.5" />
  {:else if id === "audio"}
    <path d="M6 11.5V3.5l6-1.5v8" /><circle cx="4.6" cy="11.6" r="1.6" /><circle cx="10.6" cy="10.1" r="1.6" />
  {:else if id === "record-audio"}
    <circle cx="8" cy="8" r="5.6" /><circle class="record" cx="8" cy="8" r="3" />
  {:else if id === "video"}
    <rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path class="fill" d="M6.8 6v4l3.4-2z" />
  {:else if id === "youtube"}
    <rect class="youtube" x="1.8" y="3.5" width="12.4" height="9" rx="2.6" /><path class="youtube-play" d="M6.8 6v4l3.4-2z" />
  {:else if id === "calculator"}
    <rect x="3" y="2" width="10" height="12" rx="1.5" /><path d="M5 4.5h6M5.5 7.8h.1M8 7.8h.1M10.5 7.8h.1M5.5 10.3h.1M8 10.3h.1M10.5 10.3h.1" />
  {:else if id === "tierlist"}
    <path d="M2.5 4h11M2.5 8h7.5M2.5 12h4.5" />
  {:else if id === "graph"}
    <path d="M3 2.5v11h10.5" /><circle class="dot" cx="6" cy="10" r="1" /><circle class="dot" cx="8.5" cy="6.5" r="1" /><circle class="dot" cx="11.5" cy="8" r="1" />
  {:else if id === "stats"}
    <path d="M2.5 13.5h11M4.5 13.5V9M8 13.5V4M11.5 13.5V7" />
  {:else if id === "random"}
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.2" /><circle class="dot" cx="5.5" cy="5.5" r=".9" /><circle class="dot" cx="8" cy="8" r=".9" /><circle class="dot" cx="10.5" cy="10.5" r=".9" />
  {:else if id === "glossary"}
    <path d="M3 3.5c1.8-.8 3.5-.8 5 .4v9.6c-1.5-1.2-3.2-1.2-5-.4zM13 3.5c-1.8-.8-3.5-.8-5 .4v9.6c1.5-1.2 3.2-1.2 5-.4z" />
  {:else if id === "source"}
    <path d="M7 9a2.6 2.6 0 0 0 3.7.2l2-2a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9 7a2.6 2.6 0 0 0-3.7-.2l-2 2A2.6 2.6 0 0 0 7 12.5l.9-.9" />
  {:else if id === "beacon"}
    <circle class="fill" cx="8" cy="8" r="3.2" /><circle cx="8" cy="8" r="5.6" />
  {:else if id === "map" || id === "board"}
    <path d="m2.5 4 3.7-1.5 3.6 1.5 3.7-1.5V12l-3.7 1.5L6.2 12l-3.7 1.5z" /><path d="M6.2 2.5V12M9.8 4v9.5" />
  {:else if id === "archive"}
    <rect x="2" y="3" width="12" height="3" rx=".8" /><path d="M3 6v7h10V6M6.5 8.5h3" />
  {:else if id === "trash"}
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.3 4.5l.7 9h6l.7-9" />
  {:else if id === "tools"}
    <path d="M10.2 2.8a3 3 0 0 0-3.7 3.9L2.8 10.4a1.3 1.3 0 0 0 1.8 1.8l3.7-3.7a3 3 0 0 0 3.9-3.7l-1.9 1.9-1.6-.4-.4-1.6z" />
  {/if}
</svg>

<style>
  .create-icon {
    display: block;
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    overflow: visible;
    fill: none;
    stroke: var(--icon);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.3;
  }

  .dot,
  .fill {
    fill: var(--icon);
    stroke: none;
  }

  .glow {
    filter: drop-shadow(0 0 2px color-mix(in srgb, var(--icon) 60%, transparent));
  }

  .pro { stroke: #83c38f; }
  rect.pro { fill: #263b2d; }
  .con { stroke: #dc8884; }
  rect.con { fill: #3b2928; }
  .mood { fill: #f1c85b; stroke: #fff0b0; stroke-width: 1; }
  .record { fill: #d4473f; stroke: none; }
  .accent { stroke: #d05a5a; }
  .youtube { fill: #c84646; stroke: none; }
  .youtube-play { fill: #fff; stroke: none; }
</style>
