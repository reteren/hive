import type { Note } from "../../model/note";
import type { Bounds } from "../../notes/layout.svelte";

export interface BoardCluster {
  bbox: Bounds;
  nodeIds: string[];
  label: string;
}

interface ClusterNode {
  note: Note;
  bounds: Bounds;
  linkCount: number;
  order: number;
}

/** Connected components of links and node rectangles whose edge gap is less than 15 board units. */
export function clusterNodes(
  notes: readonly Note[],
  boundsFor: (note: Note) => Bounds,
  links: readonly { from: string; to: string }[],
  proximity = 15,
): BoardCluster[] {
  const nodes: ClusterNode[] = notes.map((note, order) => ({
    note,
    bounds: boundsFor(note),
    linkCount: 0,
    order,
  }));
  if (nodes.length === 0) return [];

  const indexById = new Map(nodes.map((node, index) => [node.note.id, index]));
  const parent = nodes.map((_, index) => index);
  const rank = nodes.map(() => 0);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (first: number, second: number): void => {
    let left = find(first);
    let right = find(second);
    if (left === right) return;
    if (rank[left] < rank[right]) [left, right] = [right, left];
    parent[right] = left;
    if (rank[left] === rank[right]) rank[left] += 1;
  };

  for (const link of links) {
    const from = indexById.get(link.from);
    const to = indexById.get(link.to);
    if (from !== undefined) nodes[from].linkCount += 1;
    if (to !== undefined) nodes[to].linkCount += 1;
    if (from !== undefined && to !== undefined) union(from, to);
  }

  const validProximity = Number.isFinite(proximity) ? Math.max(0, proximity) : 15;
  const sorted = nodes.map((node, index) => ({ node, index }))
    .sort((first, second) => first.node.bounds.x - second.node.bounds.x || first.node.order - second.node.order);
  const active: typeof sorted = [];
  for (const current of sorted) {
    const left = current.node.bounds.x;
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const candidate = active[index];
      if (candidate.node.bounds.x + candidate.node.bounds.width + validProximity <= left) {
        active.splice(index, 1);
      }
    }
    for (const candidate of active) {
      if (find(current.index) === find(candidate.index)) continue;
      const first = candidate.node.bounds;
      const second = current.node.bounds;
      const gapX = Math.max(0, second.x - (first.x + first.width));
      const gapY = Math.max(0, second.y - (first.y + first.height), first.y - (second.y + second.height));
      if (Math.hypot(gapX, gapY) < validProximity) union(current.index, candidate.index);
    }
    active.push(current);
  }

  const groups = new Map<number, ClusterNode[]>();
  nodes.forEach((node, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(node);
    groups.set(root, group);
  });

  return [...groups.values()]
    .map((group) => {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const { bounds } of group) {
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
      }
      const labelNode = group.reduce((best, candidate) => candidate.linkCount > best.linkCount ? candidate : best);
      return {
        bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        nodeIds: group.map(({ note }) => note.id),
        label: labelNode.note.name,
        firstOrder: group[0].order,
      };
    })
    .sort((first, second) => first.firstOrder - second.firstOrder)
    .map(({ firstOrder: _firstOrder, ...cluster }) => cluster);
}
