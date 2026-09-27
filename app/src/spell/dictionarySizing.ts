import { PX_PER_UNIT } from "../board/cameraMath";

export const DICTIONARY_MIN_SHRINK_WORDS = 10;
export const DICTIONARY_FALLBACK_ROW_HEIGHT_PX = 23;

export interface DictionaryHeightLimits {
  autoHeight: number;
  minimumHeight: number;
  canShrink: boolean;
}

export function dictionaryHeightLimits(
  autoHeight: number,
  chromeHeight: number,
  firstRowsHeight: readonly number[],
  wordCount: number,
  fallbackRowHeight = DICTIONARY_FALLBACK_ROW_HEIGHT_PX / PX_PER_UNIT,
): DictionaryHeightLimits {
  const safeAuto = Number.isFinite(autoHeight) ? Math.max(0, autoHeight) : 0;
  if (wordCount < DICTIONARY_MIN_SHRINK_WORDS) {
    return { autoHeight: safeAuto, minimumHeight: safeAuto, canShrink: false };
  }

  const safeChrome = Number.isFinite(chromeHeight) ? Math.max(0, chromeHeight) : 0;
  const firstTenHeight = firstRowsHeight.length >= DICTIONARY_MIN_SHRINK_WORDS
    ? firstRowsHeight.slice(0, DICTIONARY_MIN_SHRINK_WORDS).reduce((sum, height) => sum + Math.max(0, height), 0)
    : fallbackRowHeight * DICTIONARY_MIN_SHRINK_WORDS;
  const minimumHeight = Math.min(safeAuto, safeChrome + firstTenHeight);
  return {
    autoHeight: safeAuto,
    minimumHeight,
    canShrink: safeAuto > minimumHeight + 0.01,
  };
}

/** Read the naturally required node size even while its word list is scrolled. */
export function measureDictionaryHeightLimits(noteId: string, wordCount: number, fallbackAutoHeight: number): DictionaryHeightLimits {
  if (typeof document === "undefined") return fallbackDictionaryLimits(fallbackAutoHeight, wordCount);
  const body = [...document.querySelectorAll<HTMLElement>("[data-dictionary-node]")]
    .find((element) => element.dataset.dictionaryNode === noteId);
  const card = body?.closest<HTMLElement>(".note-card[data-note-id]");
  const list = body?.querySelector<HTMLElement>(".dictionary-words");
  if (!body || !card || !list) return fallbackDictionaryLimits(fallbackAutoHeight, wordCount);

  const chromeHeight = Math.max(0, card.offsetHeight - list.clientHeight) / PX_PER_UNIT;
  const autoHeight = (card.offsetHeight - list.clientHeight + list.scrollHeight) / PX_PER_UNIT;
  const rowHeights = [...list.querySelectorAll<HTMLElement>("li:not(.dictionary-empty)")]
    .map((row) => row.offsetHeight / PX_PER_UNIT);
  return dictionaryHeightLimits(autoHeight, chromeHeight, rowHeights, wordCount);
}

function fallbackDictionaryLimits(autoHeight: number, wordCount: number): DictionaryHeightLimits {
  const safeAuto = Number.isFinite(autoHeight) ? Math.max(0, autoHeight) : 0;
  const rowHeight = DICTIONARY_FALLBACK_ROW_HEIGHT_PX / PX_PER_UNIT;
  const chromeHeight = Math.max(0, safeAuto - wordCount * rowHeight);
  return dictionaryHeightLimits(safeAuto, chromeHeight, [], wordCount, rowHeight);
}
