const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(await ev(`(async()=>{const s=await import('/src/selection/selection.svelte.ts');const b=await import('/src/model/board.svelte.ts');const e=document.querySelector('[data-note-id="mp"]');const r=e.getBoundingClientRect();const h=e.querySelector('[data-note-header]')?.getBoundingClientRect();
 return JSON.stringify({sel:s.selection.ids, rect:[r.x,r.y,r.width,r.height].map(Math.round), header: h?[h.x,h.y,h.width,h.height].map(Math.round):null, note:{w:b.board.notes.mp.width,h:b.board.notes.mp.height}})})()`));
// select map programmatically and count handles
console.log(await ev(`(async()=>{const s=await import('/src/selection/selection.svelte.ts');s.selectOnly?s.selectOnly('mp'):(s.selection.ids=['mp'],s.selection.primaryId='mp');await new Promise(r=>setTimeout(r,200));return [...document.querySelectorAll('[data-resize-handle]')].map(e=>e.getAttribute('data-resize-handle')).join(',')||'none'})()`));
const mv = await ev(`(()=>{const e=document.querySelector('[data-note-id="mp"] [data-map-view]');if(!e)return null;const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,top:t?t.outerHTML.slice(0,120):null,attrs:[...e.attributes].map(a=>a.name+"="+a.value).join(" ")})})()`);
console.log(JSON.stringify(mv));
ws.close();
