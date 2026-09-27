export const MIN_MAP_INTERNAL_ZOOM = 0.35;
export const MAX_MAP_INTERNAL_ZOOM = 12;
const MAP_VIEW_STORAGE_KEY = "hive.map.internalZoom";

function initialZoom(): number {
  if (typeof localStorage === "undefined") return 1;
  try {
    const value = Number(localStorage.getItem(MAP_VIEW_STORAGE_KEY));
    return Number.isFinite(value) && value >= MIN_MAP_INTERNAL_ZOOM && value <= MAX_MAP_INTERNAL_ZOOM ? value : 1;
  } catch {
    return 1;
  }
}

export const mapViewState = $state({ zoom: initialZoom() });

/** Map detail is global view state shared by the overlay and every minimap. */
export function setMapInternalZoom(value: number, persist = true): void {
  mapViewState.zoom = Math.min(MAX_MAP_INTERNAL_ZOOM, Math.max(MIN_MAP_INTERNAL_ZOOM, Number.isFinite(value) ? value : 1));
  if (!persist || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MAP_VIEW_STORAGE_KEY, String(mapViewState.zoom));
  } catch {
    // The map remains usable when browser storage is disabled.
  }
}
