<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import ReminderCard from "./ReminderCard.svelte";
  import { VISIBLE_MESSAGE_LIMIT } from "./presentation";
  import { clippedCardRects, type OverhiveSnapshot } from "./overhiveProtocol";

  let snapshot: OverhiveSnapshot = $state({ cards: [], reduceMotion: false });
  let expanded = $state(false);
  let failure = $state("");
  let root: HTMLElement | undefined = $state();
  let cards = $derived(expanded ? snapshot.cards : snapshot.cards.slice(0, VISIBLE_MESSAGE_LIMIT));
  let hidden = $derived(Math.max(0, snapshot.cards.length - VISIBLE_MESSAGE_LIMIT));
  let frame = 0, until = 0, lastRegion = "", pending = false, disposed = false;
  let acceptedRevision = -1;
  let regionRevision = 0;

  async function updateRegion(): Promise<void> {
    if (!root || disposed || pending) return;
    const rects = clippedCardRects([...root.querySelectorAll<HTMLElement>("[data-shown-message], [data-overhive-more]")]
      .map((element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }), innerWidth, innerHeight);
    const key = JSON.stringify(rects);
    if (lastRegion === key) return;
    const revision = regionRevision;
    pending = true;
    let synced = false;
    try { await invoke("set_overhive_regions", { rects }); if (revision === regionRevision) lastRegion = key; failure = ""; synced = true; }
    catch (error) { failure = "Could not update desktop reminders."; console.warn(failure, error); }
    finally { pending = false; if (synced && !disposed) void updateRegion(); }
  }
  function trackAnimation(): void {
    until = performance.now() + 900;
    if (frame) return;
    const track = () => {
      frame = 0; void updateRegion();
      if (!disposed && performance.now() < until) frame = requestAnimationFrame(track);
    };
    frame = requestAnimationFrame(track);
  }
  async function accept(value: OverhiveSnapshot): Promise<void> {
    const revision = value.revision ?? 0;
    if (disposed || revision < acceptedRevision) return;
    acceptedRevision = revision;
    // A hidden window can be shown again with identical card bounds; refresh
    // its native hit region even when the DOM rectangles did not change.
    lastRegion = "";
    regionRevision += 1;
    snapshot = value;
    document.documentElement.dataset.reduceMotion = String(value.reduceMotion);
    if (!value.cards.length) expanded = false;
    await tick(); trackAnimation();
  }
  async function action(id: string, action: "dismiss" | "go-to"): Promise<void> {
    try { await invoke("overhive_action", { id, action }); }
    catch (error) { failure = "Could not open hive. Try again."; console.warn(failure, error); }
  }
  onMount(() => {
    let unlisten: (() => void) | undefined;
    void listen<OverhiveSnapshot>("hive://overhive-state", ({ payload }) => { void accept(payload); })
      .then(async (dispose) => {
        if (disposed) { dispose(); return; }
        unlisten = dispose;
        await accept(await invoke<OverhiveSnapshot>("get_overhive_snapshot"));
      }).catch((error) => console.warn("Could not load Overhive reminders.", error));
    const observer = new ResizeObserver(() => trackAnimation());
    if (root) observer.observe(root);
    return () => { disposed = true; unlisten?.(); observer.disconnect(); cancelAnimationFrame(frame); };
  });
</script>

<main bind:this={root} class="overhive" data-overhive onscroll={trackAnimation} oncontextmenu={(event) => event.preventDefault()}>
  {#each cards as card (card.id)}
    <ReminderCard {card} title={card.title} available={card.available}
      onClose={() => { void action(card.id, "dismiss"); }} onGoTo={() => { void action(card.id, "go-to"); }} />
  {/each}
  {#if hidden > 0}<button type="button" data-overhive-more onclick={async () => { expanded = !expanded; await tick(); trackAnimation(); }}>
    {expanded ? "Show fewer" : `+${hidden} more`}
  </button>{/if}
  {#if failure}<p class="error" role="alert">{failure}</p>{/if}
</main>

<style>
  :global(html), :global(body) { margin: 0; background: transparent !important; overflow: hidden; font-family: "Segoe UI", sans-serif; color: #ddd; }
  .overhive { box-sizing: border-box; display: grid; align-content: start; gap: 6px; width: 100%; max-height: 100vh; padding: 40px 60px; overflow-y: auto; scrollbar-width: none; }
  button { padding: 5px 8px; color: #ddd; background: #282828; border: 1px solid #4b4b4b; border-radius: 4px; cursor: pointer; }
  button:hover { background: #333; }
  .error { color: #eea49b; font-size: 11px; }
</style>
