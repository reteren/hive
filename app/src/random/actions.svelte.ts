import { execute } from "../history/history.svelte";
import { emitTimeActivation } from "../time/activation.svelte";
import { board, updateNote } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import type { RandomPick } from "../model/nodeData";
import { chooseRandomItem, choicesForRandom, linkedListForRandom } from "./logic";

export type PickResult = { ok: true; pick: RandomPick } | { ok: false; reason: "no-list" | "empty" | "invalid-rng" };

export function pickFromList(randomId: string, rng: () => number = Math.random, now = Date.now()): PickResult {
  const random = board.notes[randomId];
  if (random?.type !== "random") return { ok: false, reason: "no-list" };
  const list = linkedListForRandom(randomId, board.notes, Object.values(links.byId));
  if (!list) return { ok: false, reason: "no-list" };
  const choices = choicesForRandom(list, board.notes);
  if (choices.length === 0) return { ok: false, reason: "empty" };
  const chosen = chooseRandomItem(choices, rng);
  if (!chosen) return { ok: false, reason: "invalid-rng" };
  const before = random.randomPick ? { ...random.randomPick } : undefined;
  const pick: RandomPick = { listId: list.id, itemId: chosen.id, pickedAt: now };
  let undoActivation = () => {};
  execute({
    label: "Pick from List",
    target: random.name,
    do: () => {
      updateNote(randomId, { randomPick: { ...pick } });
      undoActivation = emitTimeActivation(randomId, now);
    },
    undo: () => {
      undoActivation();
      updateNote(randomId, { randomPick: before ? { ...before } : undefined });
    },
  });
  return { ok: true, pick };
}
