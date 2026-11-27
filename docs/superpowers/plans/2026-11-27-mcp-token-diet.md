# MCP token diet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the characters an agent receives from hive's MCP tools several times over: one compact reply, slim reply shapes, short ids.

**Architecture:** Rust `mcp_stdio` sends each result once as compact JSON after a generic pass (round to 2 decimals, drop empty nested fields). The frontend dispatcher (single choke point for every bridge client) expands short ids in params and shortens ids in results; method handlers return slimmer shapes. The offline fallback in Rust mirrors short ids and shapes.

**Tech Stack:** Rust (serde_json) in `app/src-tauri/src/mcp_stdio`, TypeScript + Svelte 5 stores in `app/src/mcp`, Vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-11-27-mcp-token-diet-design.md`

## Global Constraints

- Short id = shortest unique prefix, length ≥ 8; ids of 8 chars or fewer stay as they are; `me` untouched.
- Input prefix accepted when length ≥ 6 and exactly one id matches (case-insensitive); several → `invalid_params` "Id '…' is ambiguous: matches …; use more characters"; none → value left as is.
- Input id keys: `id`, `ids`, `nodeId`, `zoneId`, `linkedTo`, `node`, `from`, `to`; never inside `data`; never a value equal to a `ref` of the same call.
- Numbers: non-integers rounded to 2 decimals. Nested object fields with `null`, `[]`, `{}` dropped; top-level keys of a result kept.
- `list_nodes`: default limit 50 (max 500), `preview` 0–300 default 80, `linkCount` only when > 0.
- Links omit `kind` when `strong`, `shape` when `base`.
- Bridge protocol stays 1. Disk format unchanged. Commits in English, no attribution, push after each commit.

## Review Focus

- A short id that became ambiguous after a new object was created → clear error listing candidates, never the wrong object (Task 2 test `ambiguous prefix throws`).
- `create_nodes` refs that look like hex (`"abc123"`) in `links[].from/to` and `near.node` → never expanded (Task 3 test `refs are not expanded`).
- Free text that equals an id prefix (`query`, `textEdit.find`, `name`) → never expanded (Task 2 test `only id keys are expanded`).
- `delete_nodes` result lists ids no longer on the board → shortened from the pre-call universe, and the trash entry is restorable by its short id (Task 3 test `deleted ids are shortened`).
- Old Node server passes full ids and gets short ones back → full ids still resolve, short ones round-trip (Task 3 test `full and short ids both resolve`).

---

### Task 1: Compact replies in Rust

**Files:**
- Create: `app/src-tauri/src/mcp_stdio/compact.rs`
- Modify: `app/src-tauri/src/mcp_stdio/mod.rs` (declare module), `app/src-tauri/src/mcp_stdio/tools.rs` (`ok`, `fail`)

**Interfaces:**
- Produces: `pub fn compact(value: &Value) -> Value`, `pub fn compact_text(value: &Value) -> String`

- [ ] **Step 1: Write failing tests in `compact.rs`**: `rounds_fractions_keeps_integers` (`249.37680395418988 → 249.38`, `0.924 → 0.92`, `1791290832123` unchanged, `2.0` stays a number equal to 2); `drops_empty_nested_fields` (`{"a":{"x":null,"y":[],"z":{},"k":1}}` → `{"a":{"k":1}}`); `keeps_top_level_keys` (`{"nodes":[],"selection":[],"x":null}` keeps all three); `arrays_keep_positions` (`[null,1.234]` → `[null,1.23]`); `compact_text_has_no_newlines`.
- [ ] **Step 2: Run `cargo test --manifest-path app/src-tauri/Cargo.toml compact`** — expect compile failure.
- [ ] **Step 3: Implement `compact`/`compact_text`.** Rounded value with zero fraction becomes an integer `Value`.
- [ ] **Step 4: `ok()` returns `{"content":[text_block(compact_text(&value))]}` (no `structuredContent`); `fail()` appends `compact_text(data)`.** Remove `pretty` import from tools.rs if unused.
- [ ] **Step 5: Run `cargo test … mcp_stdio`** — PASS.
- [ ] **Step 6: Commit** `Send each MCP result once as compact JSON with rounded numbers and no empty fields`.

### Task 2: Short id core (TS)

**Files:**
- Create: `app/src/mcp/shortIds.ts`, `app/tests/mcp.shortIds.test.ts`

**Interfaces:**
- Produces:
  - `export interface IdIndex { has(id: string): boolean; short(id: string): string; resolve(value: string): string }`
  - `export function createIdIndex(ids: Iterable<string>): IdIndex`
  - `export function shortenIds<T>(value: T, index: IdIndex): T` (deep copy, exact string matches replaced)
  - `export function expandParamIds(params: Record<string, unknown>, index: IdIndex): Record<string, unknown>`

- [ ] **Step 1: Write failing tests**: `short form is 8 chars` (two random UUIDs → first 8 chars); `colliding prefixes grow` (`aaaaaaaa-1111-…` and `aaaaaaaa-2222-…` → `aaaaaaaa-1` / `aaaaaaaa-2`); `short ids stay` (`me`, `n1` → themselves); `resolve exact, prefix, unknown` (full id → itself; 8-char → full; `"zzzzzz"` → `"zzzzzz"`; 5-char prefix → unchanged); `ambiguous prefix throws` (`resolve("aaaaaaaa")` throws `McpError` code `invalid_params`, message contains both full ids); `shortenIds replaces exact matches only` (text containing an id inside a sentence unchanged); `only id keys are expanded` (`{query: prefix, name: prefix, textEdit:{find: prefix}}` unchanged; `{ids:[prefix], updates:[{id: prefix}], near:{node: prefix}}` expanded); `data subtree untouched` (`{data:{id: prefix}}` unchanged).
- [ ] **Step 2: Run `npx vitest run tests/mcp.shortIds.test.ts`** — FAIL (module missing).
- [ ] **Step 3: Implement.** Sort lower-cased ids; required length = max(8, longest common prefix with sorted neighbours + 1), capped at id length. `resolve` binary-searches the prefix range. `expandParamIds` first collects every `ref` string anywhere in params, then walks; under an id key a string or array of strings is resolved unless it is a ref; key `data` is skipped.
- [ ] **Step 4: Run the test file** — PASS.
- [ ] **Step 5: Commit** `Add short id index for MCP: unique 8+ char prefixes, prefix resolution, key-scoped expansion`.

### Task 3: Dispatcher applies short ids

**Files:**
- Create: `app/src/mcp/idUniverse.ts`
- Modify: `app/src/mcp/dispatcher.ts`, `app/tests/mcp.dispatcher.test.ts`

**Interfaces:**
- Consumes: Task 2 API.
- Produces: `export function currentObjectIds(): string[]` (board notes, links, zones, `trash.entries[].id`, `archive.entries[].id`).

- [ ] **Step 1: Write failing tests** in `mcp.dispatcher.test.ts` with UUID-shaped ids on a real board (`replaceBoard`, `replaceLinks`, `replaceTrash`): `results carry short ids` (a registered test method returning `{id: full}` → 8 chars); `full and short ids both resolve` (method echoing `params.ids` gets full ids for both inputs); `refs are not expanded` (`{nodes:[{ref:"abc123"}], links:[{from:"abc123", to: short}]}` with a node id starting `abc123` → `from` stays `abc123`, `to` becomes full); `deleted ids are shortened` (method that removes the note and returns `{deleted:[full]}` → short); `error data is shortened` (method throwing `McpError("not_found", "…", {id: full})` → rejected error's `data.id` is short); `ambiguous input rejects before running` (method not called).
- [ ] **Step 2: Run `npx vitest run tests/mcp.dispatcher.test.ts`** — FAIL.
- [ ] **Step 3: Implement**: `dispatchMcpRequest` builds `before = createIdIndex(currentObjectIds())`, expands params, runs (inside the history transaction as today), then shortens with `createIdIndex([...beforeIds, ...currentObjectIds()])`; an `McpError` thrown anywhere is re-thrown with shortened `data`.
- [ ] **Step 4: Run all MCP tests `npx vitest run tests/mcp.`** — PASS.
- [ ] **Step 5: Commit** `Shorten ids in every MCP result and accept short ids in params`.

### Task 4: Slim zones

**Files:**
- Modify: `app/src/mcp/readMethods.ts` (`zones.list`), `app/src/mcp/moreMethods.ts` (`zoneInfo`, create/update), `app/src/mcp/viewMethods.ts` (overview zones), `app/src-tauri/src/mcp_stdio/tools.rs` (`list_zones` schema/description); tests `mcp.readMethods`, `mcp.moreMethods`, `mcp.viewMethods`.

**Interfaces:**
- Produces: `export function zoneSummary(zone: Zone, options?: { members?: boolean; geometry?: boolean }): ZoneSummary` in `app/src/mcp/read/serialize.ts`; `ZoneSummary = { id, name, color, rect: ZoneBounds, nodeCount, nodeIds?, parts?, holes? }`.

- [ ] **Step 1: Update tests first**: `zones.list` → `[{id:"z1", name:"Research", color:"#608ac1", rect:{x:0,y:0,width:70,height:100}, nodeCount:2}]`; with `{members:true}` adds `nodeIds:["n1","me"]`; with `{geometry:true}` adds `parts`/`holes`; `zones.create` result has `nodeCount` and no `nodeIds`; overview zones have `nodeCount` instead of `nodeIds` (clusters keep `nodeIds`).
- [ ] **Step 2: Run the three test files** — FAIL.
- [ ] **Step 3: Implement `zoneSummary`** (rect from `zoneBounds`), use it in `zones.list` (reads `members`/`geometry` booleans, `invalid_params` on non-boolean), `zones.create`, `zones.update`, overview. `list_zones` schema gets `members` and `geometry` booleans; description: "… rectangle and node count. Member ids: list_nodes {zoneId} or members:true; polygon points: geometry:true."
- [ ] **Step 4: Run tests + `cargo check`** — PASS.
- [ ] **Step 5: Commit** `List zones as name, colour, rectangle and node count; members and geometry on request`.

### Task 5: Lighter list_nodes

**Files:**
- Modify: `app/src/mcp/readMethods.ts` (`nodes.list`), `app/src/mcp/read/serialize.ts` (`nodeSummary`), `app/src-tauri/src/mcp_stdio/tools.rs` (schema); test `mcp.readMethods.test.ts`.

**Interfaces:**
- Produces: `nodeSummary(note: Note, previewLength = 80): NodeSummary` with `linkCount?: number`.

- [ ] **Step 1: Tests**: default page holds 50 of 60 notes, `total` 60; `preview: 0` → no `textPreview`; `preview: 5` → 5 chars; `preview: 301` → `invalid_params`; note without links has no `linkCount`; `zoneId` filter returns the nodes `zoneOf` puts in the zone (a note inside the zone rectangle whose stored `zoneId` is unset is listed).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: `DEFAULT_NODE_LIMIT = 50`; `preview` via `parseInteger(params.preview, "preview", 80, 300)` with min 0; empty preview omitted; filter `zoneOf(note.id) === zoneId`. Schema: `preview` integer 0–300 "Characters of text preview, default 80; 0 = none."; limit description "Default 50."; tool description "80-character text preview".
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** `list_nodes: 50 per page, 80-character preview with a preview parameter, zone filter matches zone membership`.

### Task 6: Short write acks and link defaults

**Files:**
- Modify: `app/src/mcp/write/nodes.ts` (`updateNodes`, `moveNodes`, `arrangeNodes`), `app/src/mcp/read/serialize.ts` (`linkInfo`), `app/src-tauri/src/mcp_stdio/tools.rs` (link tool descriptions); tests `mcp.writeMethods`, `mcp.moreMethods`, `mcp.readMethods`.

**Interfaces:**
- Produces: `nodes.move → { moved: number }`; `nodes.arrange → { nodes: {id,x,y}[] }`; `nodes.update → { updated: {id,name,x,y,width,height}[] }` (height = effective height); `LinkInfo.kind?`, `LinkInfo.shape?`.

- [ ] **Step 1: Update tests** to the new shapes; link `{kind:"strong", shape:"base"}` lists without both keys, `weak`/`orthogonal` keeps them.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; remove `summarize` if nothing uses it. Descriptions of `list_links`/`create_links`/`update_links`: "kind and shape are left out when they are the defaults (strong, base)". Contract doc lines for these methods updated in Task 8.
- [ ] **Step 4: Run `npx vitest run tests/mcp.` + `npm run check`** — PASS.
- [ ] **Step 5: Commit** `Short MCP write acks; links omit the default kind and shape`.

### Task 7: Offline fallback mirrors it (Rust)

**Files:**
- Create: `app/src-tauri/src/mcp_stdio/short_ids.rs`
- Modify: `app/src-tauri/src/mcp_stdio/offline.rs`, `app/src-tauri/src/mcp_stdio/tools.rs` (`read`, `read_node_content`), `mod.rs`

**Interfaces:**
- Produces: `pub struct IdIndex` with `new(ids: impl IntoIterator<Item = String>) -> Self`, `short(&self, id: &str) -> String`, `resolve(&self, value: &str) -> Result<String, HiveError>`, `shorten(&self, value: &Value) -> Value`, `expand_params(&self, params: &Value) -> Result<Value, HiveError>` — same rules as Task 2. `OfflineProject::object_ids(&self) -> Vec<String>`. `Tools::read` fallback becomes `impl FnOnce(&OfflineProject, &Value) -> Value` receiving expanded params.

- [ ] **Step 1: Tests** in `short_ids.rs` mirroring Task 2's (8 chars, collision growth, ambiguous error, keys only, refs, data); in `offline.rs`: `zones(&json!({}))` gives `nodeCount`/`rect`, `members:true` adds `nodeIds`; `list` default 50 and `preview`; link infos omit defaults.
- [ ] **Step 2: Run `cargo test … mcp_stdio`** — FAIL.
- [ ] **Step 3: Implement**; `zones` takes `input: &Value`; offline read path = expand params → fallback → shorten with the project's index; `read_node_content` offline resolves each id through the index.
- [ ] **Step 4: Run `cargo test … mcp_stdio`** — PASS.
- [ ] **Step 5: Commit** `Offline MCP reads use short ids and the slim zone, node and link shapes`.

### Task 8: Agent-facing texts and contract

**Files:**
- Modify: `app/src-tauri/src/mcp_stdio/mod.rs` (`INSTRUCTIONS`), `tools.rs` (`node_id()` description), `docs/handoff/d34_mcp_contract.md`

- [ ] **Step 1:** `INSTRUCTIONS` gains: "Ids are short (8 characters, a few longer to stay unique); pass them back exactly as given — full ids work too." `node_id()` description: "Node id as returned by hive (short or full)."
- [ ] **Step 2:** Contract: reply shapes from Tasks 4–6, short id rules, compact reply.
- [ ] **Step 3: `cargo test … mcp_stdio`** — PASS. **Commit** `Describe short ids and the slim replies to agents and in the MCP contract`.

### Task 9: Measure, verify, release 2.2.5

- [ ] **Step 1:** `npm run check`, `npm test`, `cargo test --manifest-path app/src-tauri/Cargo.toml` — all green.
- [ ] **Step 2:** Isolated release build (`tauri build --config devid.json --no-bundle`), scratch copy of `C:\sidequest-kingdom-files` board, `%APPDATA%\dev.hive.cliptest\last-project.json` pointed at it; Node stdio client measures chars of `list_zones`, `list_nodes`, `list_links`, `get_nodes` (5 ids), `move_nodes` (short id), `create_nodes`+links by ref, and offline `list_zones` after closing hive. Targets: `list_zones` ≤ 4000, `list_nodes` ≤ 10000, `move_nodes` ≤ 50. Never press Configure.
- [ ] **Step 3:** Bump 2.2.4 → 2.2.5 (package.json, package-lock.json ×2, tauri.conf.json, Cargo.toml, Cargo.lock), commit `2.2.5`, signed build, rel225 folder with exe, sig, latest.json; STATUS.md entry with the before/after table and the "switch Claude Code to hive.exe mcp" note; commit `Status: 2.2.5`.
