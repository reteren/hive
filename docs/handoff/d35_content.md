# d35 — MCP: read the CONTENT of every node + see the board

User (Russian, binding): «исправь это чтобы он мог считывать все даже ютуб ссылки» — after «изучи проект» an AI agent must be able to study pictures, files, PDFs, YouTube links and everything else in the project, not only note text.
Extends the d34 contract (C:\hive\docs\handoff\d34_mcp_contract.md — same rules: registry in app/src/mcp, McpError codes, untrusted params, no new npm deps). These methods are READ-ONLY (mutating:false) — they must never change the board, selection, editor or history. Common worker rules: C:\hive\docs\handoff\d31common.md (rules section).

## New bridge methods

### `nodes.content` `{ id, maxImagePx?: number (default 1024, 256..2048), pdfPages?: { from?: number, to?: number } (default 1..30), maxTextChars?: number (default 200000) }` → `NodeContent`
One node, everything an AI needs to understand it. Common header: `{ id, type, name, text /* full Markdown body, may be "" */ }` plus per kind:
- **note / any text-bearing kind**: `inlineImages: ImagePayload[]` for every `![alt](att:file)` token in the text (in order, max 10, rest listed in `omittedImages`), `links: UrlInfo[]` for every http(s) URL in the text (deduped, max 50).
- **image** (incl. GIF): `image: ImagePayload` — the picture itself. GIF → first frame + `animated: true`. Also `opacity`, `flipX/flipY` if set.
- **format** (text/code/json/csv/md/…): `file: { name, mime, size }`, `content: string` (truncated to maxTextChars, `truncated: true`), `language` (from the extension).
- **pdf**: `file`, `pageCount`, `pages: [{ page, text }]` for the requested range via the existing pdf.js client (app/src/formats/pdfjsClient.ts; text via getTextContent, keep line breaks reasonable), `truncated` when more pages exist.
- **audio / video**: `file` (+ `externalPath` and `missing: true` when the linked file is gone), `duration`, `naturalWidth/Height`, `recordings` (dictaphone list with durations). No transcription. For video also `poster: ImagePayload` = a frame from ~10 % of the duration when the file is available (best effort, skip on error).
- **youtube**: `youtube: { videoId, url, title?, author?, start?, loop? }` (what the node stores; the MCP server enriches it further).
- **source**: `source: { url, filePath, file, description }`; when `file` (project copy) is a text-like file include `content` like format; when it is an image include `image`.
- **beacon / modules / lists / tierlist / goal / calendar / time / message / etc.**: the stored kind-specific data as-is (`data: {...}` — same field names as board.json) so the AI can read list items, tiers, goals, dates, calculator entries…; tier cards that reference images → `tierImages: ImagePayload[]` (max 10).
- every kind: `links: UrlInfo[]` also collects URLs from `source.url`, `youtube.url`, markdown links.
`ImagePayload = { file, mime: "image/png"|"image/jpeg", data: base64, width, height, originalWidth, originalHeight }` — read the attachment through the same URL the app uses (convertFileSrc/asset), draw to a canvas scaled so the longest side ≤ maxImagePx, encode JPEG (quality 0.85) for photos / PNG when the source has alpha. Never return more than ~6 MB total per call; drop the largest images first and list them in `omittedImages` with the reason.
`UrlInfo = { url, kind: "youtube"|"web", videoId? }` — YouTube detection must accept youtu.be, youtube.com/watch?v=, /shorts/, /embed/, /live/, m. and music. hosts, extra params.

### `view.capture` `{ ids?: string[], bbox?: {x,y,width,height}, maxPx?: number (default 1600, 512..3000) }` → `{ image: ImagePayload, bbox, zoom }`
A real screenshot of the board as the user sees it (nodes, drawings, links, zones, glow…). With ids/bbox: temporarily move the camera to fit that area (padding 8 %), wait until it is rendered (two frames + images decoded / PDF pages settled, time-box 1.5 s), capture, then restore the exact previous camera. Without both: the current viewport. Capture must work when the window is behind other windows; when the window is hidden to the tray or minimized → `unsupported` "Open the hive window to capture the board." Rust: capture the WebView2 content via ICoreWebView2::CapturePreview (PNG stream) through Tauri's `with_webview`, return bytes; frontend crops nothing — it moves the camera instead. Downscale to maxPx longest side. Hide transient UI (context menus, tooltips, hover states) is NOT required.

### `board.overview` `{}` → `{ project, counts, bounds, zones: [{ id, name, bbox, nodeIds }], clusters: [{ bbox, nodeIds, label }], kinds: { [type]: count }, media: { images, gifs, pdfs, audio, video, youtube, formats, sources }, tasks: { open, done }, recent: NodeSummary[] (10 newest), largestTexts: [{ id, name, chars }] }`
A cheap map of the whole project so an agent can plan its study. Clusters = connected components of links + spatial proximity (nodes closer than 15 u), label = the most-linked node's name.

## MCP server (coordinator, C:\mcp hive)
New tools `read_node_content` (1–10 ids → MCP text + image content blocks), `view_board`, `get_board_overview`, `read_youtube` (oEmbed title/author/thumbnail + best-effort transcript, works for any YouTube URL, not only nodes), and an MCP prompt `study_project`. YouTube enrichment happens in Node (no CSP), so the app only reports what it stores.
