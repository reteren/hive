const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
console.log(await ev(`(async()=>{const nc=await import('/src/notes/noteCommands.ts');const b=await import('/src/model/board.svelte.ts');const t=nc.createNoteKind('trash');const a=nc.createNoteKind('archive');await new Promise(r=>setTimeout(r,400));
 const sz=(id)=>{const n=b.board.notes[id];const r=document.querySelector('[data-note-id="'+id+'"]').getBoundingClientRect();return n.width+'x'+n.height+' u, '+Math.round(r.width)+'x'+Math.round(r.height)+' px'};return 'trash '+sz(t)+' | archive '+sz(a)})()`));
ws.close();
