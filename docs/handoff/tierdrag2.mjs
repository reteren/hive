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
async function drag(from, to) {
  await mouse('mouseMoved', from.x, from.y); await mouse('mousePressed', from.x, from.y, 'left', 1);
  for (let i=1;i<=12;i++){ await mouse('mouseMoved', from.x+(to.x-from.x)*i/12, from.y+(to.y-from.y)*i/12, 'left', 1); await wait(20);}
  await mouse('mouseReleased', to.x, to.y, 'left', 0); await wait(300);
}
const state = () => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.notes.tl;return JSON.stringify({tiers:n.tiers.map(r=>r.name+':'+r.cards.map(c=>c.id).join(',')),pos:[n.x,n.y],notes:Object.keys(b.board.notes).length})})()`);
const rect = (sel, idx=0) => ev(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${idx}];if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,l:r.x,r:r.right}})()`);
await drag(card, row);
console.log('1 S->A:', await state());
// reorder within row S: move k2 to the left of ... add k3 in A first? drag k1 back to S at left edge
const s = await rect('[data-tier-row-cards]', 0);
const k1 = await rect('[data-tier-card-id="k1"]');
await drag(k1, { x: s.l + 8, y: s.y });
console.log('2 A->S start:', await state());
const k2 = await rect('[data-tier-card-id="k2"]');
const k1b = await rect('[data-tier-card-id="k1"]');
await drag(k2, { x: k1b.l + 4, y: k1b.y });
console.log('3 reorder within S (k2 before k1):', await state());
const k1c = await rect('[data-tier-card-id="k1"]');
await drag(k1c, { x: 1100, y: 650 });
console.log('4 drag out to board (notes +1, card gone):', await state());
const shot = await send("Page.captureScreenshot", { format: "png" });
(await import("node:fs")).writeFileSync(process.argv[2] ?? "C:/Users/reteren/AppData/Local/Temp/claude/tier.png", Buffer.from(shot.result.data, "base64"));
ws.close();
