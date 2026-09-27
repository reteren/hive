import { describe, expect, it, vi } from "vitest";
import { HistoryStack } from "../src/history/historyStack";
import {
  createSourceEditCommand,
  emptySource,
  sourceFileLabel,
  sourceResourceStatus,
  SourceFileAvailabilityCache,
  validateSourceUrl,
} from "../src/source/logic";
import type { SourceData } from "../src/model/nodeData";

describe("source URL validation", () => {
  it("accepts absolute HTTP and HTTPS URLs and normalizes whitespace", () => {
    expect(validateSourceUrl("  https://example.com/path  ")).toEqual({
      valid: true,
      url: "https://example.com/path",
    });
    expect(validateSourceUrl("http://localhost:8080")).toEqual({
      valid: true,
      url: "http://localhost:8080/",
    });
  });

  it.each(["", "relative/path", "ftp://example.com", "javascript:alert(1)", "http://"]) (
    "rejects %j",
    (url) => expect(validateSourceUrl(url).valid).toBe(false),
  );
});

describe("source display state", () => {
  it("splits a Windows path into its file name and folder", () => {
    expect(sourceFileLabel("C:\\Research\\paper.pdf")).toEqual({ name: "paper.pdf", folder: "C:\\Research" });
  });

  it("shows URL readiness without probing network availability", () => {
    const source: SourceData = { url: "https://example.com", filePath: null, description: "saved" };
    expect(sourceResourceStatus(source, "unknown")).toEqual({ url: "ready", file: "none" });
    expect(sourceResourceStatus(source, "unknown", true)).toEqual({ url: "open-failed", file: "none" });
  });

  it("reports a missing selected file while retaining source data", () => {
    const source: SourceData = { ...emptySource(), filePath: "C:\\Research\\paper.pdf", description: "Keep this note" };
    expect(sourceResourceStatus(source, "missing")).toEqual({ url: "empty", file: "missing" });
    expect(source.description).toBe("Keep this note");
  });
});

describe("source edit history", () => {
  it("merges a typing burst into one undo and redo step", () => {
    let current: SourceData | undefined;
    const stack = new HistoryStack();
    const apply = (value: SourceData | undefined) => { current = value ? { ...value } : undefined; };
    const before = emptySource();
    const first = { ...before, description: "P" };
    const second = { ...before, description: "Pa" };

    apply(first);
    stack.record(createSourceEditCommand({
      target: "Paper",
      before,
      after: first,
      meta: { field: "description", group: 2, kind: "typing", at: 100, selectionBefore: { start: 0, end: 0 }, selectionAfter: { start: 1, end: 1 } },
      apply,
    }));
    apply(second);
    stack.record(createSourceEditCommand({
      target: "Paper",
      before: first,
      after: second,
      meta: { field: "description", group: 2, kind: "typing", at: 150, selectionBefore: { start: 1, end: 1 }, selectionAfter: { start: 2, end: 2 } },
      apply,
    }));

    expect(stack.entries).toHaveLength(1);
    stack.undo();
    expect(current).toEqual(before);
    stack.redo();
    expect(current).toEqual(second);
  });

  it("does not merge separate focus groups or edits beyond the merge window", () => {
    let current: SourceData | undefined;
    const stack = new HistoryStack();
    const apply = (value: SourceData | undefined) => { current = value ? { ...value } : undefined; };
    let before = emptySource();
    let after = { ...before, url: "h" };
    apply(after);
    stack.record(createSourceEditCommand({
      target: "Paper", before, after,
      meta: { field: "url", group: 1, kind: "typing", at: 100, selectionBefore: { start: 0, end: 0 }, selectionAfter: { start: 1, end: 1 } }, apply,
    }));
    before = after;
    after = { ...before, url: "ht" };
    apply(after);
    stack.record(createSourceEditCommand({
      target: "Paper", before, after,
      meta: { field: "url", group: 2, kind: "typing", at: 150, selectionBefore: { start: 1, end: 1 }, selectionAfter: { start: 2, end: 2 } }, apply,
    }));
    expect(stack.entries).toHaveLength(2);
  });
});

describe("source file availability cache", () => {
  it("caches results, deduplicates pending checks, and expires stale results", async () => {
    let now = 0;
    const cache = new SourceFileAvailabilityCache(100, () => now);
    const load = vi.fn(async () => "missing" as const);
    const [first, second] = await Promise.all([cache.check("C:\\missing.txt", load), cache.check("C:\\missing.txt", load)]);
    expect(first).toBe("missing");
    expect(second).toBe("missing");
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.check("C:\\missing.txt", load)).toBe("missing");
    expect(load).toHaveBeenCalledTimes(1);

    now = 101;
    expect(await cache.check("C:\\missing.txt", load)).toBe("missing");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
