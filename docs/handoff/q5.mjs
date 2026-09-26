const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const r = await send("Runtime.evaluate", { expression: `(()=>{const b=document.querySelector('[aria-label*="Delete card" i], [title*="Delete card" i]');if(!b)return [...document.querySelectorAll('[data-tier-card-id="ak1"] *')].map(e=>e.tagName+'.'+e.className).slice(0,10).join(' ');const r=b.getBoundingClientRect();const s=b.querySelector('svg')?.getBoundingClientRect();return JSON.stringify({btn:[r.x+r.width/2,r.y+r.height/2],svg:s?[s.x+s.width/2,s.y+s.height/2]:null})})()`, returnByValue: true });
console.log(r.result.result.value); ws.close();
