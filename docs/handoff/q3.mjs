const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails?.exception?.description); };
console.log(await ev(`(async()=>{const l=await import('/src/model/links.svelte.ts');const b=await import('/src/model/board.svelte.ts');
 const all=Object.values(l.links.byId); return JSON.stringify({n:all.length, m: all.filter(k=>k.from==='st'&&k.kind==='strong'&&b.board.notes[k.to]?.type==='tierlist').length, src: (await (await fetch('/src/stats/linkedTierlist.svelte.ts')).text()).slice(0,80)})})()`));
ws.close();
