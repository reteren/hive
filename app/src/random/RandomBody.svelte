<script lang="ts">
  import { board } from "../model/board.svelte";
  import { links } from "../model/links.svelte";
  import type { Note } from "../model/note";
  import { teleportToObject } from "../navigation/navigate";
  import { pickFromList } from "./actions.svelte";
  import { choicesForRandom, currentRandomPick, linkedListForRandom } from "./logic";

  let { note }: { note: Note } = $props();
  let linkedList = $derived(linkedListForRandom(note.id, board.notes, Object.values(links.byId)));
  let choices = $derived(linkedList ? choicesForRandom(linkedList, board.notes) : []);
  let current = $derived(currentRandomPick(note.randomPick, linkedList, board.notes));
</script>

<div class="random-body note-body" data-random-node={note.id} data-selection-ignore>
  <button class="random-pick" type="button" data-random-pick disabled={!linkedList || choices.length === 0}
    onclick={() => pickFromList(note.id)}>Pick</button>
  {#if !linkedList}
    <p class="random-hint">Draw a strong link from a List to this Random Choice.</p>
  {:else if choices.length === 0}
    <p class="random-hint">{linkedList.name} has no available rows. Add text or a live board link to the List.</p>
  {:else}
    {#if current}
      <div class="random-result" data-random-result>
        {#if current.item.targetId && !current.missing}
          <button type="button" onclick={() => teleportToObject(current.item.targetId!, { label: "Open Random choice" })}>{current.label}</button>
        {:else}
          <strong>{current.label}</strong>
        {/if}
        <small>from {linkedList.name}{current.missing ? " · target missing" : ""}</small>
      </div>
    {:else if note.randomPick}
      <p class="random-hint">The previous choice is no longer in this List.</p>
    {/if}
  {/if}
</div>

<style>
  .random-body { display: grid; min-width: 0; gap: 7px; padding: 3px; font-size: 11px; }
  .random-hint { margin: 0; color: var(--text-dim); line-height: 1.4; }
  .random-pick { justify-self: start; padding: 5px 12px; border: 1px solid #927d49; border-radius: 3px; color: #f4dda2; background: #3a3324; font: inherit; cursor: pointer; }
  .random-pick:hover { border-color: var(--accent); background: #493b21; }
  .random-pick:disabled { opacity: 0.45; cursor: default; }
  .random-result { display: grid; min-width: 0; gap: 3px; padding: 7px; border: 1px solid #55504a; border-radius: 3px; background: #292723; }
  .random-result button, .random-result strong { min-width: 0; overflow: hidden; color: #f1ddb0; font: inherit; font-size: 15px; font-weight: 700; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
  .random-result button { padding: 0; border: 0; background: transparent; cursor: pointer; }
  .random-result button:hover { text-decoration: underline; }
  .random-result small { color: var(--text-dim); font-size: 10px; }
</style>
