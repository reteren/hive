import { syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import { EditorState, StateEffect, Transaction, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { addSpellingWord, checkSpelling, clearSpellcheckSuggestionCache, suggestSpelling } from "./engine";

export type SpellcheckContext = { from: number; to: number; word: string; languages: string[] };
export type TextRange = { from: number; to: number };
export type SpellcheckOptions = () => { enabled: boolean; languages: readonly string[] };

/** Translate UTF-16 offsets within an eligible segment into line-relative editor offsets. */
export function mapSpellcheckRangesToLine(
  segmentFrom: number,
  lineFrom: number,
  ranges: readonly TextRange[],
): TextRange[] {
  return ranges.map((range) => ({
    from: segmentFrom + range.from - lineFrom,
    to: segmentFrom + range.to - lineFrom,
  }));
}

const CODE_LINK_NODES = new Set([
  "fencedcode", "codeblock", "inlinecode", "codetext", "codeinfo", "codemark",
  "link", "linklabel", "linkmark", "linktitle", "autolink", "image", "url",
]);
const ALWAYS_SKIP_NODES = new Set(["image", "url", "htmltag", "htmlblock"]);
const spellMark = Decoration.mark({ class: "cm-hive-misspelled" });
const spellcheckRefresh = StateEffect.define<null>();
const activePlugins = new Set<SpellcheckPlugin>();
const spellcheckCache = new Map<string, Promise<TextRange[]>>();

function skippedNode(name: string, skipCodeAndLinks: boolean): boolean {
  const normalized = name.toLowerCase();
  return ALWAYS_SKIP_NODES.has(normalized) || (skipCodeAndLinks && CODE_LINK_NODES.has(normalized));
}

function addRegexRanges(text: string, base: number, pattern: RegExp, ranges: TextRange[]): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const from = base + (match.index ?? 0);
    if (match[0].length > 0) ranges.push({ from, to: from + match[0].length });
  }
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: TextRange[] = [];
  for (const range of ranges) {
    if (range.to <= range.from) continue;
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/** Absolute excluded spans for one line, including Markdown syntax and URL-like text. */
export function spellcheckExcludedRanges(
  state: EditorState,
  line: { from: number; to: number; text: string },
  skipCodeAndLinks = true,
): TextRange[] {
  const ranges: TextRange[] = [];
  const first = state.doc.lines > 0 ? state.doc.line(1) : null;
  if (first && /^\uFEFF?---\s*$/u.test(first.text)) {
    let end = state.doc.length;
    for (let lineNumber = 2; lineNumber <= state.doc.lines; lineNumber += 1) {
      const candidate = state.doc.line(lineNumber);
      if (/^(?:---|\.\.\.)\s*$/u.test(candidate.text)) { end = candidate.to; break; }
    }
    if (first.from < line.to + 1 && end > line.from) {
      ranges.push({ from: Math.max(line.from, first.from), to: Math.min(line.to, end) });
    }
  }

  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (skippedNode(node.name, skipCodeAndLinks)) {
        const from = Math.max(line.from, node.from);
        const to = Math.min(line.to, node.to);
        if (to > from) ranges.push({ from, to });
        return false;
      }
    },
  });

  addRegexRanges(line.text, line.from, /!\[[^\]\n]*\](?:\([^\n)]*\)|\[[^\]\n]*\])?/gu, ranges);
  addRegexRanges(line.text, line.from, /<[^>\n]*>/gu, ranges);
  addRegexRanges(line.text, line.from, /(?:https?:\/\/|ftp:\/\/|mailto:|www\.)[^\s<>()]+/giu, ranges);
  addRegexRanges(line.text, line.from, /\b(?:[a-z\d-]+\.)+[a-z]{2,}(?:\/[^\s<>()]*)?/giu, ranges);
  return mergeRanges(ranges)
    .map((range) => ({ from: Math.max(line.from, range.from), to: Math.min(line.to, range.to) }))
    .filter((range) => range.to > range.from);
}

/** Eligible spans only; these are the strings sent to the native checker. */
export function spellcheckLineSegments(
  state: EditorState,
  line: { from: number; to: number; text: string },
  skipCodeAndLinks = true,
): TextRange[] {
  const excluded = spellcheckExcludedRanges(state, line, skipCodeAndLinks);
  const result: TextRange[] = [];
  let cursor = line.from;
  for (const range of excluded) {
    if (range.from > cursor) result.push({ from: cursor, to: range.from });
    cursor = Math.max(cursor, range.to);
  }
  if (cursor < line.to) result.push({ from: cursor, to: line.to });
  return result.filter((range) => range.to > range.from);
}

function cacheKey(line: { text: string; from: number }, languages: readonly string[], exclusions: readonly TextRange[]): string {
  return JSON.stringify([line.text, [...languages].sort(), exclusions.map((range) => [range.from - line.from, range.to - line.from])]);
}

/** Convert UTF-16 offsets returned by Rust into CodeMirror document offsets. */
export async function checkSpellcheckLine(
  state: EditorState,
  line: { from: number; to: number; text: string },
  languages: readonly string[],
  skipCodeAndLinks = true,
): Promise<TextRange[]> {
  if (languages.length === 0 || line.text.length === 0) return [];
  const exclusions = spellcheckExcludedRanges(state, line, skipCodeAndLinks);
  const key = cacheKey(line, languages, exclusions);
  const existing = spellcheckCache.get(key);
  if (existing) return existing;

  const request = Promise.all(spellcheckLineSegments(state, line, skipCodeAndLinks).map(async (segment) => {
    const text = state.sliceDoc(segment.from, segment.to);
    const ranges = await checkSpelling(text, languages);
    return ranges
      .filter((range) => range.from >= 0 && range.to <= text.length)
      .flatMap((range) => mapSpellcheckRangesToLine(segment.from, line.from, [range]));
  })).then((parts) => parts.flat());
  spellcheckCache.set(key, request);
  if (spellcheckCache.size > 4096) {
    const oldest = spellcheckCache.keys().next().value;
    if (oldest !== undefined) spellcheckCache.delete(oldest);
  }
  return request;
}

export function clearSpellcheckCache(): void {
  spellcheckCache.clear();
  clearSpellcheckSuggestionCache();
}

function isExcludedAt(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (CODE_LINK_NODES.has(node.name.toLowerCase()) && pos >= node.from && pos <= node.to) return true;
    node = node.parent;
  }
  return false;
}

class SpellcheckPlugin {
  decorations: DecorationSet = Decoration.none;
  private ranges: TextRange[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;
  private destroyed = false;

  constructor(private readonly view: EditorView, private readonly options: SpellcheckOptions) {
    activePlugins.add(this);
    this.schedule(350);
  }

  update(update: ViewUpdate): void {
    if (update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(spellcheckRefresh)))) return;
    if (update.docChanged || update.viewportChanged) {
      if (update.docChanged) this.ranges = [];
      this.schedule(350);
    }
    if (update.docChanged || update.selectionSet) this.rebuild(update.state);
  }

  destroy(): void {
    this.destroyed = true;
    activePlugins.delete(this);
    if (this.timer !== null) clearTimeout(this.timer);
  }

  contextAt(pos: number): SpellcheckContext | null {
    const range = this.ranges.find((item) => pos >= item.from && pos <= item.to);
    if (!range || isExcludedAt(this.view.state, pos)) return null;
    return {
      from: range.from,
      to: range.to,
      word: this.view.state.sliceDoc(range.from, range.to),
      languages: [...this.options().languages],
    };
  }

  refreshNow(): void { this.schedule(0); }

  private schedule(delay: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const config = this.options();
    if (!config.enabled || config.languages.length === 0) {
      this.ranges = [];
      this.rebuild(this.view.state);
      this.dispatchRefresh();
      return;
    }
    this.timer = setTimeout(() => { this.timer = null; void this.checkVisibleLines(); }, delay);
  }

  private async checkVisibleLines(): Promise<void> {
    const state = this.view.state;
    const doc = state.doc;
    const revision = ++this.revision;
    const languages = [...this.options().languages];
    if (!this.options().enabled || languages.length === 0) { this.ranges = []; this.rebuild(this.view.state); return; }
    const lines = new Set<number>();
    for (const visible of this.view.visibleRanges) {
      const first = state.doc.lineAt(visible.from).number;
      const last = state.doc.lineAt(visible.to).number;
      for (let number = Math.max(1, first - 3); number <= Math.min(state.doc.lines, last + 3); number += 1) lines.add(number);
    }
    const checked = await Promise.all([...lines].map(async (number) => {
      const line = state.doc.line(number);
      const ranges = await checkSpellcheckLine(state, line, languages);
      return ranges.map((range) => ({ from: line.from + range.from, to: line.from + range.to }));
    }));
    if (this.destroyed || revision !== this.revision || this.view.state.doc !== doc) return;
    this.ranges = checked.flat().filter((range) => range.to > range.from && range.to <= doc.length);
    this.rebuild(this.view.state);
    this.dispatchRefresh();
  }

  private rebuild(state: EditorState): void {
    const config = this.options();
    const ranges: Range<Decoration>[] = config.enabled
      ? this.ranges.filter((range) => range.to <= state.doc.length && range.to > range.from)
        .map((range) => ({ from: range.from, to: range.to, value: spellMark }))
      : [];
    this.decorations = ranges.length ? Decoration.set(ranges, true) : Decoration.none;
  }

  private dispatchRefresh(): void {
    queueMicrotask(() => {
      if (!this.destroyed) this.view.dispatch({ effects: spellcheckRefresh.of(null) });
    });
  }
}

const spellcheckPlugin = ViewPlugin.define<SpellcheckPlugin, SpellcheckOptions>(
  (view, options) => new SpellcheckPlugin(view, options),
  { decorations: (plugin) => plugin.decorations },
);

export function getSpellcheckContextAt(view: EditorView, pos: number): SpellcheckContext | null {
  return view.plugin(spellcheckPlugin)?.contextAt(pos) ?? null;
}

export function refreshSpellcheck(view: EditorView): void {
  view.plugin(spellcheckPlugin)?.refreshNow();
}

export function refreshAllSpellcheckEditors(): void {
  for (const plugin of activePlugins) plugin.refreshNow();
}

export async function addWordToSpellcheckDictionary(context: SpellcheckContext): Promise<void> {
  await addSpellingWord(context.word, context.languages);
  clearSpellcheckCache();
  refreshAllSpellcheckEditors();
}

export function replaceSpellcheckWord(view: EditorView, context: SpellcheckContext, suggestion: string): boolean {
  if (!suggestion || context.from < 0 || context.to <= context.from || context.to > view.state.doc.length) return false;
  if (view.state.sliceDoc(context.from, context.to) !== context.word || suggestion.includes("\n")) return false;
  view.dispatch({
    changes: { from: context.from, to: context.to, insert: suggestion },
    selection: { anchor: context.from + suggestion.length },
    annotations: [Transaction.userEvent.of("input.spellcheck"), isolateHistory.of("full")],
  });
  return true;
}

export function spellcheckExtension(options: SpellcheckOptions): Extension[] {
  return [
    EditorView.baseTheme({
      ".cm-hive-misspelled": { textDecoration: "underline wavy #ef6a67", textUnderlineOffset: "0.16em" },
    }),
    spellcheckPlugin.of(options),
  ];
}
