import { archive, trash } from "../model/retention.svelte";
import { board } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import { zones } from "../model/zones.svelte";
import type { Note, NoteKind } from "../model/note";
import { zoneBounds } from "../model/zone";
import { noteBounds } from "../notes/layout.svelte";
import { project } from "../project/project.svelte";
import { zoneMembers } from "../zones/membership.svelte";
import { displayPath, nodeSummary } from "./read/serialize";
import { asParams, McpError, registerMcpMethod } from "./registry";
import { clusterNodes } from "./view/clusters";
import { captureBoard } from "./view/capture";

function requireProject(): void {
  if (!project.path.trim()) throw new McpError("no_project", "Open a project in hive before reading project data.");
  if (!project.ready) throw new McpError("busy", "The project is still loading. Retry this read request in a moment.");
}

function orderedNotes(): Note[] {
  return board.order.flatMap((id) => board.notes[id] ? [board.notes[id]] : []);
}

function unionBounds(bounds: readonly { x: number; y: number; width: number; height: number }[]): { x: number; y: number; width: number; height: number } | null {
  if (bounds.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const box of bounds) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

registerMcpMethod({
  name: "board.overview",
  mutating: false,
  run: (value) => {
    requireProject();
    const params = asParams(value);
    const unknown = Object.keys(params)[0];
    if (unknown) throw new McpError("invalid_params", `board.overview does not accept '${unknown}'.`);

    const notes = orderedNotes();
    const noteBoxes = notes.map((note) => noteBounds(note));
    const zoneList = zones.order.flatMap((id) => {
      const zone = zones.byId[id];
      if (!zone) return [];
      return [{ id: zone.id, name: zone.name, bbox: zoneBounds(zone), nodeIds: zoneMembers(id) }];
    });
    const bounds = unionBounds([...noteBoxes, ...zoneList.map(({ bbox }) => bbox)]);
    const kinds: Partial<Record<NoteKind, number>> = {};
    const media = { images: 0, gifs: 0, pdfs: 0, audio: 0, video: 0, youtube: 0, formats: 0, sources: 0 };
    let openTasks = 0;
    let doneTasks = 0;
    notes.forEach((note) => {
      kinds[note.type] = (kinds[note.type] ?? 0) + 1;
      if (note.task) {
        if (note.task.done) doneTasks += 1;
        else openTasks += 1;
      }
      switch (note.type) {
        case "image":
          media.images += 1;
          if (note.image?.mime.toLowerCase() === "image/gif") media.gifs += 1;
          break;
        case "pdf": media.pdfs += 1; break;
        case "audio": media.audio += 1; break;
        case "video": media.video += 1; break;
        case "youtube": media.youtube += 1; break;
        case "format": media.formats += 1; break;
        case "source": media.sources += 1; break;
      }
    });

    const orderById = new Map(notes.map((note, index) => [note.id, index]));
    const recent = [...notes]
      .sort((left, right) => (right.createdAt ?? Number.NEGATIVE_INFINITY) - (left.createdAt ?? Number.NEGATIVE_INFINITY) ||
        (orderById.get(left.id) ?? 0) - (orderById.get(right.id) ?? 0))
      .slice(0, 10)
      .map(nodeSummary);
    const largestTexts = [...notes]
      .filter((note) => note.text.length > 0)
      .sort((left, right) => right.text.length - left.text.length ||
        (orderById.get(left.id) ?? 0) - (orderById.get(right.id) ?? 0))
      .slice(0, 10)
      .map(({ id, name, text }) => ({ id, name, chars: text.length }));
    const clusters = clusterNodes(notes, noteBounds, Object.values(links.byId));

    return {
      project: { name: project.name, root: displayPath(project.path) },
      counts: {
        nodes: notes.length,
        links: Object.keys(links.byId).length,
        zones: zoneList.length,
        trash: trash.entries.length,
        archive: archive.entries.length,
      },
      bounds,
      zones: zoneList,
      clusters,
      kinds,
      media,
      tasks: { open: openTasks, done: doneTasks },
      recent,
      largestTexts,
    };
  },
});

registerMcpMethod({
  name: "view.capture",
  mutating: false,
  run: async (value) => {
    requireProject();
    return captureBoard(value);
  },
});
