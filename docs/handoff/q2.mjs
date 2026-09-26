const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails?.exception?.description); };
console.log(await ev(`(async()=>{const l=await import('/src/model/links.svelte.ts');const s=await import('/src/stats/linkedTierlist.svelte.ts');const c=await import('/src/board/camera.svelte.ts');c.camera.x=-40;
 return JSON.stringify({link:l.links.byId.sl, view: !!s.tierlistViewForStats('st'), types:[(await import('/src/model/board.svelte.ts')).board.notes.st?.type,(await import('/src/model/board.svelte.ts')).board.notes.tl?.type], linked: !!s.linkedTierlistForStats('st'), dom: document.querySelector('[data-note-id="st"] [data-stats-view]')?.getAttribute('data-stats-view')})})()`));
await new Promise(r=>setTimeout(r,500));

ws.close();
