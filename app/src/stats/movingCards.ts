/** Keep moving cards and their transformed world above peers without changing board order. */
export function raiseMovingCards(cards: readonly HTMLElement[]): () => void {
  const saved = new Map<HTMLElement, { zIndex: string; moving: string | null }>();
  for (const card of cards) {
    const world = card.closest<HTMLElement>(".notes-world, .beacons-world");
    for (const element of world ? [world, card] : [card]) {
      if (!saved.has(element)) saved.set(element, { zIndex: element.style.zIndex, moving: element.getAttribute("data-node-moving") });
      element.style.zIndex = "1000";
    }
    card.setAttribute("data-node-moving", "true");
  }
  return () => {
    for (const [element, previous] of saved) {
      element.style.zIndex = previous.zIndex;
      if (previous.moving === null) element.removeAttribute("data-node-moving");
      else element.setAttribute("data-node-moving", previous.moving);
    }
    saved.clear();
  };
}
