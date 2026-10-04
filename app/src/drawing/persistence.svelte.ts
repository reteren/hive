import { drawingLoad, drawingReadTile, drawingSave, type DrawingTileChange } from "./api";
import { drawingTileStore } from "./tileStore.svelte";
import {
  DRAW_PX_PER_UNIT,
  DRAW_TILE_SIZE_PX,
  parseTileKey,
  type DrawingIndex,
  type TileKey,
} from "./types";
import { project } from "../project/project.svelte";

const SAVE_DEBOUNCE_MS = 300;

/** Attach project loading and debounced tile writes to the mounted drawing layer. */
export function startDrawingPersistence(): () => void {
  let stopped = false;
  let loading = false;
  let generation = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueue = Promise.resolve();
  const pendingKeys = new Set<TileKey>();

  function scheduleSave(keys: readonly TileKey[]): void {
    if (stopped || !project.ready || !project.path) return;
    for (const key of keys) pendingKeys.add(key);
    if (loading) return;
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void savePending();
    }, SAVE_DEBOUNCE_MS);
  }

  async function savePending(): Promise<void> {
    if (stopped || loading || !project.ready || !project.path || pendingKeys.size === 0) return;
    const projectPath = project.path;
    const keys = [...pendingKeys];
    pendingKeys.clear();
    const requestGeneration = generation;
    saveQueue = saveQueue.then(async () => {
      if (stopped || loading || requestGeneration !== generation || project.path !== projectPath) return;
      const pngs = await drawingTileStore.exportPngs(keys);
      if (stopped || requestGeneration !== generation || project.path !== projectPath) return;
      const changes: DrawingTileChange[] = keys.map((key) => ({ key, png: pngs.get(key) ?? null }));
      const index = makeIndex(drawingTileStore.allKeys());
      await drawingSave(changes, index);
    }).catch((error: unknown) => {
      console.error("Could not save drawing tiles", error);
    });
    await saveQueue;
    if (pendingKeys.size > 0 && !stopped && !loading) scheduleSave([]);
  }

  async function loadProject(path: string): Promise<void> {
    const requestGeneration = ++generation;
    loading = true;
    pendingKeys.clear();
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = undefined;
    try {
      // Clear before awaiting the new project's disk state so old tiles never flash under it.
      await drawingTileStore.replaceFromPngs(new Map());
      const result = await drawingLoad();
      if (stopped || requestGeneration !== generation || project.path !== path) return;
      const index = result.index;
      if (!index) return;
      if (index.version !== 1 || index.pxPerUnit !== DRAW_PX_PER_UNIT || index.tileSizePx !== DRAW_TILE_SIZE_PX ||
        !Array.isArray(index.tiles) || index.tiles.length > 100_000) {
        throw new Error("The drawing index has an unsupported format.");
      }
      const uniqueKeys = new Set<TileKey>();
      for (const key of index.tiles) {
        const parsed = parseTileKey(key);
        if (!parsed || !Number.isSafeInteger(parsed.col) || !Number.isSafeInteger(parsed.row) ||
          Math.abs(parsed.col) > 10_000_000 || Math.abs(parsed.row) > 10_000_000) {
          throw new Error(`The drawing index contains an invalid tile key: ${key}`);
        }
        uniqueKeys.add(key);
      }
      const entries = await Promise.all([...uniqueKeys].map(async (key) => {
        const bytes = await drawingReadTile(key);
        return [key, new Blob([bytes], { type: "image/png" })] as const;
      }));
      if (stopped || requestGeneration !== generation || project.path !== path) return;
      await drawingTileStore.replaceFromPngs(new Map(entries));
      const loadedKeys = new Set(drawingTileStore.allKeys());
      for (const key of uniqueKeys) if (!loadedKeys.has(key)) pendingKeys.add(key);
    } catch (error) {
      if (!stopped && requestGeneration === generation) console.error("Could not load drawing tiles", error);
    } finally {
      if (requestGeneration === generation) {
        loading = false;
        if (pendingKeys.size > 0) scheduleSave([]);
      }
    }
  }

  const stopEffect = $effect.root(() => {
    $effect(() => {
      const path = project.path;
      const ready = project.ready;
      if (ready && path) void loadProject(path);
      else {
        generation += 1;
        loading = false;
        pendingKeys.clear();
        void drawingTileStore.replaceFromPngs(new Map());
      }
    });
  });

  drawingTileStore.setCommitListener((changedKeys) => scheduleSave(changedKeys));
  return () => {
    stopped = true;
    generation += 1;
    drawingTileStore.setCommitListener(null);
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    stopEffect();
  };
}

function makeIndex(keys: readonly TileKey[]): DrawingIndex {
  return {
    version: 1,
    pxPerUnit: DRAW_PX_PER_UNIT,
    tileSizePx: DRAW_TILE_SIZE_PX,
    tiles: [...keys],
  };
}
