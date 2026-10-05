# d34 — hive MCP bridge: contract (binding for every worker)

User goal (Russian, binding): «я хочу из своей программы сделать замену обсидиана … mcp работало максимально точно … давать задачи по созданию нод … чтобы он создавал ноды и что-то писал и в целом чтобы mcp работал идеально точно с программой».
User decisions (05.10): changes go THROUGH THE RUNNING hive (no direct file writes); when hive is closed the MCP server may only READ the project folder; first version covers everything core + every node kind; ONE MCP call = ONE Undo step (label "MCP: …").

## Architecture

```
AI client ──stdio── hive-mcp (Node/TS, C:\mcp hive, coordinator writes it)
                       │ TCP 127.0.0.1:<port>, newline-delimited JSON, token
                       ▼
hive Rust: src-tauri/src/mcp_bridge.rs ──event "hive://mcp-request"──▶ frontend src/mcp/*
                       ◀──invoke("mcp_respond")──────────────────────┘
```

### Discovery file (Rust writes, MCP server reads)
`<app config dir>/mcp-bridge.json` (same dir as hive's last-project file; on Windows `%APPDATA%\dev.hive.app\`):
```json
{ "protocol": 1, "port": 51234, "token": "<64 hex>", "pid": 1234, "appVersion": "1.7.0",
  "project": { "name": "Main", "root": "C:\\Users\\...\\Main" } }
```
Written atomically when the bridge starts and whenever the open project changes; deleted on clean exit and when the setting is turned off. Token: 32 random bytes, new each launch.

### Wire protocol (TCP, UTF-8 JSON, one object per line, max line 8 MB)
1. Client → `{"type":"hello","token":"…","client":"hive-mcp/0.1.0","protocol":1}`
2. Server → `{"type":"welcome","protocol":1,"appVersion":"1.7.0"}` or `{"type":"error","code":"unauthorized","message":"…"}` then close. Wrong/missing token or protocol mismatch → error + close. No hello within 5 s → close.
3. Then requests `{"id":7,"method":"nodes.create","params":{…}}` → `{"id":7,"result":…}` or `{"id":7,"error":{"code":"not_found","message":"…","data":{…}}}`.
Several connections allowed; requests are executed strictly one at a time (global FIFO) in the frontend. Per-request timeout 30 s in Rust → error `timeout`.

### Rust ↔ frontend
- Rust emits event `hive://mcp-request` to the main window: `{ requestId: string, method: string, params: unknown }`.
- Frontend answers `invoke("mcp_respond", { requestId, ok: boolean, payload: unknown })` (payload = result or `{code,message,data?}`).
- Frontend calls `invoke("mcp_bridge_ready")` once its listener is installed; before that Rust answers `busy` ("hive is still starting").
- Setting `Allow AI tools (MCP)` (Settings, new section "AI tools", default ON) → `invoke("mcp_bridge_set_enabled", { enabled })`. Off = listener closed, discovery file deleted, open connections closed.

### Error codes
`unauthorized, protocol_mismatch, busy, timeout, no_project, not_found, invalid_params, name_conflict, unsupported, internal`. Messages are short English sentences an AI can act on ("Node 'abc' not found. Use nodes.list or search to get ids.").

## Frontend method registry (src/mcp/registry.ts — coordinator created it)

```ts
registerMcpMethod({ name: "nodes.create", mutating: true, label: (p) => "create 3 nodes", run: (p) => result })
```
- `run` may be async; throw `McpError(code, message, data?)` for expected failures.
- `mutating: true` → the dispatcher wraps `run` in a history transaction: every history.execute/record inside it is collected and recorded as ONE command "MCP: <label>" (undo = reverse undos, redo = re-run dos in order). If `run` throws, everything already applied is undone and nothing is recorded. (Task A implements `beginHistoryTransaction/commitHistoryTransaction/abortHistoryTransaction` in src/history.)
- Prefer calling the app's own user-facing actions (they already execute history commands, keep selection/zones/links/trash consistent). If an action has UI side effects that make no sense for MCP (opens editor, selects, scrolls), add an option to that action rather than duplicating its logic.
- Never leave the editor/selection in a weird state: after a mutating call the new/changed nodes may become the selection (like the UI does), the editor is NOT opened.
- Every board change is saved by the normal persistence (no special save path).

## Data shapes returned to the AI

`NodeSummary`: `{ id, type, name, x, y, width, height /* effective, measured when auto */, color?, task?: {done}, importance?, purposes?, moods?, zoneId?, textPreview /* first 160 chars, plain */, linkCount }`
`NodeFull`: the stored Note JSON (all fields, as in board.json, plus `text`) + `height` effective + `links: LinkInfo[]` + `zone?: {id,name}`.
`LinkInfo`: `{ id, from, to, kind: "strong"|"weak", shape, fromName, toName }`
`ZoneInfo`: zone JSON + `nodeIds` (members).
Coordinates are board units (u); x,y = top-left; y grows downward. Node ids are permanent strings; names are unique per project (the app's uniqueName rule) — when a requested name is taken, the call fails with `name_conflict` unless `"onNameConflict":"rename"` (default "rename" for create, "error" for rename).

## Methods

### Read (mutating:false) — task B
- `status` → `{ appVersion, protocol, project:{name, root}, counts:{nodes, links, zones, trash, archive}, camera:{x,y,zoom}, viewport:{x,y,width,height} /* board units */, selection: string[] }`
- `schema` → `{ kinds: [{ type, label, description, defaultWidth, hasText, dataFields: {field: "short description / allowed values"} }], enums: { importance, purposes, moods, linkKinds, linkShapes }, markdown: "notes on supported Markdown + inline images + links-in-text syntax" }` — generated from the real constants (NoteKind, IMPORTANCE_LEVELS, PURPOSE_KINDS, MOOD_KINDS, R5_BASE_WIDTHS, link shapes) so it never drifts.
- `nodes.list` `{ types?, zoneId?, task?: "open"|"done"|"any"|"none", query?, bbox?:{x,y,width,height}, linkedTo?: id, sort?: "position"|"created"|"name", limit? (100, max 500), offset? }` → `{ total, nodes: NodeSummary[] }`
- `nodes.get` `{ ids?: string[], names?: string[] }` (≤ 50) → `{ nodes: NodeFull[], missing: string[] }` (names matched exactly, then case-insensitively)
- `search` `{ query, types?, limit? (20, max 100) }` → `{ results: [{ id, name, type, matchedIn: "name"|"kind"|"text", snippet }] }` — reuse src/search/matching.ts (same ranking as the Search panel).
- `links.list` `{ nodeId? }` → `{ links: LinkInfo[] }`
- `zones.list` → `{ zones: ZoneInfo[] }`
- `trash.list` / `archive.list` → `{ entries: [{ id, name, type, deletedAt }] }`

### Write — nodes (mutating:true) — task C
- `nodes.create` `{ nodes: CreateSpec[], links?: [{ from, to, kind?: "strong", shape? }], layout?: "auto"|"row"|"column"|"grid"|"tree", origin?: {x,y}, gap?: number }` → `{ created: [{ ref?, id, name, x, y, width, height }], links: string[] }`
  `CreateSpec = { ref?: string /* temp id usable in links/near within this call */, type: NoteKind (default "note"), name?, text?, x?, y?, near?: { node: id|ref, side?: "right"|"left"|"below"|"above", gap? }, width?, height?, color?, accentColor?, glow?, headerHidden?, task?: boolean | {done:boolean}, importance?, purposes?, moods?, zoneId?, data?: object /* kind-specific, validated with the same parsers as board.json loading */ }`
  Placement: explicit x/y wins; else `near`; else `layout` from `origin` (default: centre of the current viewport) — never overlapping existing nodes (reuse creationObstacleForNote / randomFreeNoteCenter / notePositionAt) and not each other. "tree" lays out by the `links` given (parents left → children right).
  Build each node with the app's own constructor (`makeNote` in notes/noteCommands.ts — export it) so defaults equal the Q menu, then apply the spec and validate the result with the board.json parser (project/index.ts parseNote) — an invalid result → `invalid_params` naming the field.
  Kind specifics (time restart, beacon size, module nodes, media without a file → invalid_params "use files.import") follow the existing creation code paths.
- `nodes.update` `{ updates: [{ id, name?, text?, textEdit?: { find: string, replace: string, all?: boolean } | { append: string } | { prepend: string }, x?, y?, width?, height? (null = auto), color? (null clears), accentColor?, glow? (null clears), headerHidden?, task?: boolean | {done:boolean} | null, importance? (null clears), purposes?, moods?, zoneId?, data? }] }` → `{ nodes: NodeSummary[] }`. `textEdit.find` must match exactly once unless `all` → otherwise `invalid_params` with the match count. Renames keep the .md file in sync through the normal rename path.
- `nodes.delete` `{ ids, mode?: "trash" | "archive" }` (default trash, exactly like Delete in the UI incl. its links) → `{ deleted: string[] }`
- `nodes.arrange` `{ ids, layout: "row"|"column"|"grid"|"tree"|"circle", origin?, gap? }` and `nodes.move` `{ moves: [{ id, x, y }] }` → `{ nodes: NodeSummary[] }`

### Write — links, zones, files, view, history, trash — task D
- `links.create` `{ links: [{ from, to, kind?: "strong"|"weak", shape? }] }` → `{ links: LinkInfo[] }` (respect canLink/linkRefusalReason → `invalid_params` with the reason)
- `links.update` `{ updates: [{ id, kind?, shape? }] }`, `links.delete` `{ ids }`
- `zones.create` `{ name?, color?, rect?: {x,y,width,height}, around?: { ids, padding? } }` → ZoneInfo; `zones.update` `{ id, name?, color?, rect? }`; `zones.delete` `{ ids }` (members stay)
- `files.import` `{ path /* absolute */, x?, y?, near?, name? }` → `{ node: NodeSummary }` — same pipeline as an OS drop (image/gif/pdf/audio/video/format/source; external-video threshold setting respected)
- `trash.restore` `{ ids }` → `{ restored }`
- `view.focus` `{ ids?, bbox?, zoom? }` — moves the camera to fit (NOT an undo step, mutating:false)
- `history.undo` `{ onlyIfMcp?: true }` → `{ undone: label | null }` — with onlyIfMcp (default true) refuses (`unsupported`) when the top entry is not an "MCP: …" entry. mutating:false (it IS the undo).
- `project.save` → flushes pending saves `{ saved: true }`

## Testing
Each worker: Vitest for its methods (call the registry directly; no Tauri needed — mock invoke). Use existing board/link/zone fixtures. The coordinator does end-to-end checks with the real MCP server.
