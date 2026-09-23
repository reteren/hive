import {
  cycleSearchIndex,
  reconcileSearchIndex,
  type SearchResult,
} from "./matching";

export const searchState = $state({
  open: false,
  query: "",
  results: [] as SearchResult[],
  /** Index into results ordered by creation time, with legacy notes after dated notes. */
  currentIndex: 0,
});

export function openSearch(): void {
  searchState.open = true;
}

export function closeSearch(): void {
  searchState.open = false;
}

/** Clear transient search state when changing projects. */
export function resetSearch(): void {
  searchState.open = false;
  searchState.query = "";
  searchState.results = [];
  searchState.currentIndex = 0;
}

export function setSearchQuery(query: string): void {
  if (searchState.query === query) return;
  searchState.query = query;
  searchState.results = [];
  searchState.currentIndex = 0;
}

export function setSearchResults(results: readonly SearchResult[]): void {
  const nextResults = [...results];
  searchState.currentIndex = reconcileSearchIndex(
    searchState.results,
    searchState.currentIndex,
    nextResults,
  );
  searchState.results = nextResults;
}

export function cycleSearchResults(delta: number): void {
  searchState.currentIndex = cycleSearchIndex(
    searchState.currentIndex,
    delta,
    searchState.results.length,
  );
}

export function selectSearchResult(index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= searchState.results.length) return false;
  searchState.currentIndex = index;
  return true;
}

export function currentSearchResult(): SearchResult | undefined {
  return searchState.results[searchState.currentIndex];
}
