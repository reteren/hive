import type { HistoryCommand } from "../history/historyStack";
import type { SourceData } from "../model/nodeData";

export const EMPTY_SOURCE: Readonly<SourceData> = {
  url: null,
  filePath: null,
  description: "",
};

export type SourceField = keyof SourceData;
export type SourceTextEditKind = "typing" | "backspace" | "forward-delete" | "atomic";

export interface SourceEditMeta {
  field: SourceField;
  group: number;
  kind: SourceTextEditKind;
  at: number;
  selectionBefore?: { start: number; end: number };
  selectionAfter?: { start: number; end: number };
}

export type UrlValidation =
  | { valid: true; url: string }
  | { valid: false; error: string };

export type FileAvailability = "available" | "missing" | "unknown";

interface CachedAvailability {
  state: FileAvailability;
  expiresAt: number;
}

/** Deduplicates cheap file checks and keeps render/focus refreshes from hitting Rust repeatedly. */
export class SourceFileAvailabilityCache {
  private readonly entries = new Map<string, CachedAvailability>();
  private readonly pending = new Map<string, Promise<FileAvailability>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(path: string, load: () => Promise<FileAvailability>): Promise<FileAvailability> {
    const cached = this.entries.get(path);
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(cached.state);

    const inFlight = this.pending.get(path);
    if (inFlight) return inFlight;

    const request = load()
      .catch((): FileAvailability => "unknown")
      .then((state) => {
        const ttl = state === "unknown" ? Math.min(this.ttlMs, 1_000) : this.ttlMs;
        this.entries.set(path, { state, expiresAt: this.now() + ttl });
        return state;
      })
      .finally(() => this.pending.delete(path));
    this.pending.set(path, request);
    return request;
  }

  invalidate(path: string): void {
    this.entries.delete(path);
  }
}

export interface SourceResourceStatus {
  url: "empty" | "invalid" | "ready" | "open-failed";
  file: "none" | FileAvailability;
}

export function emptySource(): SourceData {
  return { ...EMPTY_SOURCE };
}

export function normalizeSource(source?: SourceData): SourceData {
  return {
    url: source?.url || null,
    filePath: source?.filePath || null,
    description: source?.description ?? "",
  };
}

export function validateSourceUrl(rawUrl: string): UrlValidation {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { valid: false, error: "Enter a URL." };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Enter a valid http or https URL." };
  }

  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    return { valid: false, error: "Use an http:// or https:// URL." };
  }

  return { valid: true, url: parsed.href };
}

export function sourceResourceStatus(
  source: SourceData,
  fileAvailability: FileAvailability,
  urlOpenFailed = false,
): SourceResourceStatus {
  const urlState = source.url
    ? urlOpenFailed
      ? "open-failed"
      : validateSourceUrl(source.url).valid ? "ready" : "invalid"
    : "empty";

  return {
    url: urlState,
    file: source.filePath ? fileAvailability : "none",
  };
}

export function sourceFileLabel(path: string): { name: string; folder: string } {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return {
    name: separator === -1 ? normalized : normalized.slice(separator + 1),
    folder: separator === -1 ? "" : normalized.slice(0, separator) || normalized.slice(0, 1),
  };
}

const SOURCE_TEXT_MERGE_WINDOW_MS = 1000;
const MERGEABLE_SOURCE_EDIT_KINDS = new Set<SourceTextEditKind>(["typing", "backspace"]);
const SOURCE_COMMAND = Symbol("source-history-command");

interface SourceEditCommandInput {
  target: string;
  before: SourceData | undefined;
  after: SourceData | undefined;
  meta: SourceEditMeta;
  apply(source: SourceData | undefined): void;
}

interface SourceEditCommand extends HistoryCommand {
  [SOURCE_COMMAND]: true;
  before: SourceData | undefined;
  after: SourceData | undefined;
  meta: SourceEditMeta;
}

export function createSourceEditCommand(input: SourceEditCommandInput): HistoryCommand {
  const command: SourceEditCommand = {
    [SOURCE_COMMAND]: true,
    label: "Edit source",
    target: input.target,
    before: cloneSource(input.before),
    after: cloneSource(input.after),
    meta: { ...input.meta },
    do() {
      input.apply(cloneSource(command.after));
    },
    undo() {
      input.apply(cloneSource(command.before));
    },
    merge(next) {
      if (!isSourceEditCommand(next)) return false;
      if (command.target !== next.target || command.meta.field !== next.meta.field) return false;
      if (command.meta.group !== next.meta.group || command.meta.kind !== next.meta.kind) return false;
      if (!MERGEABLE_SOURCE_EDIT_KINDS.has(command.meta.kind)) return false;
      if (next.meta.at < command.meta.at || next.meta.at - command.meta.at > SOURCE_TEXT_MERGE_WINDOW_MS) return false;
      if (!sameSelection(command.meta.selectionAfter, next.meta.selectionBefore)) return false;
      if (!sameSource(command.after, next.before)) return false;

      command.after = cloneSource(next.after);
      command.meta = { ...next.meta };
      return true;
    },
  };
  return command;
}

function sameSelection(
  after: SourceEditMeta["selectionAfter"],
  before: SourceEditMeta["selectionBefore"],
): boolean {
  if (!after || !before) return true;
  return after.start === before.start && after.end === before.end;
}

function isSourceEditCommand(command: HistoryCommand): command is SourceEditCommand {
  return (command as Partial<SourceEditCommand>)[SOURCE_COMMAND] === true;
}

function cloneSource(source: SourceData | undefined): SourceData | undefined {
  return source ? { ...source } : undefined;
}

function sameSource(left: SourceData | undefined, right: SourceData | undefined): boolean {
  const a = normalizeSource(left);
  const b = normalizeSource(right);
  return a.url === b.url && a.filePath === b.filePath && a.description === b.description;
}
