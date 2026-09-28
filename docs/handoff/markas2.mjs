const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
console.log(await ev(`(()=>{const b=document.querySelector('[data-kind="markas"] .markas-add');if(!b)return 'no add button';const r=b.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return JSON.stringify({r:[r.x,r.y,r.width,r.height].map(Math.round),top:t?t.outerHTML.slice(0,160):null,card:(()=>{const c=document.querySelector('[data-kind="markas"]');const q=c.getBoundingClientRect();return [q.x,q.y,q.width,q.height].map(Math.round)})()})})()`));
ws.close();
