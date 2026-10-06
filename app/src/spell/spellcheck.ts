import { syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import { EditorState, StateEffect, StateField, Transaction, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, showTooltip, type DecorationSet, type Tooltip, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { addSpellingWord, checkSpelling, clearSpellcheckSuggestionCache, suggestSpelling } from "./engine";

export type SpellcheckContext = { from: number; to: number; word: string; languages: string[] };
export type TextRange = { from: number; to: number };
export type SpellcheckOptions = () => { enabled: boolean; languages: readonly string[]; inlineSuggestions?: boolean };

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
const inlineTooltipEffect = StateEffect.define<SpellcheckContext & { suggestions: string[] } | null>();
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

function wordAt(text: string, lineFrom: number, pos: number): TextRange | null {
  for (const match of text.matchAll(/[\p{L}\p{M}\p{N}_'’\-]+/gu)) {
    const from = lineFrom + (match.index ?? 0);
    const to = from + match[0].length;
    if (pos >= from && pos <= to) return { from, to };
  }
  return null;
}

function activeTypingRange(state: EditorState): TextRange | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const line = state.doc.lineAt(selection.head);
  const range = wordAt(line.text, line.from, selection.head);
  return range && range.to === selection.head ? range : null;
}

function inlineTarget(state: EditorState, ranges: readonly TextRange[]): TextRange | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const line = state.doc.lineAt(selection.head);
  const target = wordAt(line.text, line.from, selection.head);
  if (!target || isExcludedAt(state, selection.head)) return null;
  return ranges.find((range) => range.from === target.from && range.to === target.to) ?? null;
}

function inlineTooltip(data: SpellcheckContext & { suggestions: string[] }): Tooltip {
  return {
    pos: data.from,
    end: data.to,
    above: true,
    strictSide: true,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-hive-spell-suggestions";
      dom.setAttribute("role", "group");
      dom.setAttribute("aria-label", "Spelling suggestions");
      for (const suggestion of data.suggestions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cm-hive-spell-suggestion";
        button.textContent = suggestion;
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          replaceSpellcheckWord(view, data, suggestion);
          view.focus();
        });
        dom.append(button);
      }
      return { dom };
    },
  };
}

const inlineTooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(inlineTooltipEffect)) return effect.value ? inlineTooltip(effect.value) : null;
    }
    return value;
  },
  provide: (field) => showTooltip.from(field),
});

class SpellcheckPlugin {
  decorations: DecorationSet = Decoration.none;
  private ranges: TextRange[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;
  private destroyed = false;
  private typingRange: TextRange | null = null;
  private tooltipKey: string | null = null;
  private tooltipRevision = 0;

  constructor(private readonly view: EditorView, private readonly options: SpellcheckOptions) {
    activePlugins.add(this);
    this.schedule(350);
  }

  update(update: ViewUpdate): void {
    if (update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(spellcheckRefresh)))) return;
    if (update.docChanged || update.viewportChanged) {
      if (update.docChanged) {
        this.ranges = [];
        this.typingRange = activeTypingRange(update.state);
      }
      this.schedule(350);
    }
    if (update.selectionSet && this.typingRange) {
      const selection = update.state.selection.main;
      if (!selection.empty || selection.head < this.typingRange.from || selection.head > this.typingRange.to) this.typingRange = null;
    }
    if (update.docChanged || update.selectionSet) {
      this.rebuild(update.state);
      this.updateInlineTooltip(update.state);
    }
  }

  destroy(): void {
    this.destroyed = true;
    activePlugins.delete(this);
    if (this.timer !== null) clearTimeout(this.timer);
    this.tooltipRevision += 1;
  }

  contextAt(pos: number): SpellcheckContext | null {
    const range = this.ranges.find((item) => pos >= item.from && pos <= item.to
      && (!this.typingRange || item.from !== this.typingRange.from || item.to !== this.typingRange.to));
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
      this.updateInlineTooltip(this.view.state);
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
    if (!this.options().enabled || languages.length === 0) {
      this.ranges = [];
      this.rebuild(this.view.state);
      this.updateInlineTooltip(this.view.state);
      return;
    }
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
    this.updateInlineTooltip(this.view.state);
    this.dispatchRefresh();
  }

  private rebuild(state: EditorState): void {
    const config = this.options();
    const ranges: Range<Decoration>[] = config.enabled
      ? this.ranges.filter((range) => range.to <= state.doc.length && range.to > range.from)
        .filter((range) => !this.typingRange || range.from !== this.typingRange.from || range.to !== this.typingRange.to)
        .map((range) => ({ from: range.from, to: range.to, value: spellMark }))
      : [];
    this.decorations = ranges.length ? Decoration.set(ranges, true) : Decoration.none;
  }

  private updateInlineTooltip(state: EditorState): void {
    const config = this.options();
    const target = config.enabled && config.inlineSuggestions
      ? inlineTarget(state, this.ranges.filter((range) => !this.typingRange
        || range.from !== this.typingRange.from || range.to !== this.typingRange.to))
      : null;
    if (!target) {
      this.tooltipKey = null;
      this.tooltipRevision += 1;
      this.dispatchTooltip(null);
      return;
    }
    const word = state.sliceDoc(target.from, target.to);
    const key = JSON.stringify([target.from, target.to, word, [...config.languages]]);
    if (key === this.tooltipKey) return;
    this.tooltipKey = key;
    const revision = ++this.tooltipRevision;
    this.dispatchTooltip(null);
    void suggestSpelling(word, config.languages).then((suggestions) => {
      if (this.destroyed || revision !== this.tooltipRevision || key !== this.tooltipKey || suggestions.length === 0) return;
      this.dispatchTooltip({ ...target, word, languages: [...config.languages], suggestions: suggestions.slice(0, 3) });
    });
  }

  private dispatchTooltip(data: (SpellcheckContext & { suggestions: string[] }) | null): void {
    queueMicrotask(() => {
      if (!this.destroyed) this.view.dispatch({ effects: inlineTooltipEffect.of(data) });
    });
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
    inlineTooltipField,
    EditorView.baseTheme({
      ".cm-hive-misspelled": { textDecoration: "underline wavy #ef6a67", textUnderlineOffset: "0.16em" },
      ".cm-hive-spell-suggestions": {
        display: "flex", alignItems: "center", gap: "4px", padding: "3px",
        border: "1px solid #4b4b4b", borderRadius: "4px", backgroundColor: "var(--bg-panel)",
        boxShadow: "0 3px 12px rgb(0 0 0 / 35%)",
      },
      ".cm-hive-spell-suggestion": {
        padding: "3px 7px", border: "0", borderRadius: "3px", backgroundColor: "transparent",
        color: "var(--text)", font: "inherit", fontWeight: "600", cursor: "pointer",
      },
      ".cm-hive-spell-suggestion:hover, .cm-hive-spell-suggestion:focus-visible": {
        backgroundColor: "var(--bg-hover)", outline: "none",
      },
    }),
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.key !== "Escape" || !view.state.field(inlineTooltipField, false)) return false;
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ effects: inlineTooltipEffect.of(null) });
        return true;
      },
    }),
    spellcheckPlugin.of(options),
  ];
}
