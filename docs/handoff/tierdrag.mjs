const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const mouse = (type, x, y, button = "none", buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
console.log(await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');
 b.addNote({id:'tl',type:'tierlist',name:'T',text:'',x:-30,y:-30,width:60,height:null,createdAt:Date.now(),
 tiers:[{id:'S',name:'S',color:'#FF4B5C',cards:[{id:'k1',kind:'text',text:'One'},{id:'k2',kind:'text',text:'Two'}]},{id:'A',name:'A',color:'#FFB347',cards:[]}]});
 c.camera.x=0;c.camera.y=-10;c.camera.zoom=1;return 'ok'})()`));
await wait(600);
const card = await ev(`(()=>{const e=document.querySelector('[data-tier-card-id="k1"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const row = await ev(`(()=>{const e=document.querySelectorAll('[data-tier-row-cards]')[1];const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
console.log('card', JSON.stringify(card), 'rowA', JSON.stringify(row));
await ev(`window.__log=[];for(const t of ['pointerdown','pointermove','pointerup','dragstart','drop']) window.addEventListener(t,e=>{if(window.__log.length<40)window.__log.push(t+':'+(e.target?.className||e.target?.tagName)+':'+e.defaultPrevented)},true);1`);
await mouse('mouseMoved', card.x, card.y); await mouse('mousePressed', card.x, card.y, 'left', 1);
for (let i=1;i<=12;i++){ await mouse('mouseMoved', card.x+(row.x-card.x)*i/12, card.y+(row.y-card.y)*i/12, 'left', 1); await wait(20);}
await mouse('mouseReleased', row.x, row.y, 'left', 0); await wait(300);
console.log(await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.notes.tl;return JSON.stringify({tiers:n.tiers.map(r=>r.name+':'+r.cards.map(c=>c.id).join(',')),pos:[n.x,n.y]})})()`));
console.log(await ev(`window.__log.slice(0,12).join('\n')`));
ws.close();
