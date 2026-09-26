// 1.1.9 tierlist polish smoke: indicator size at two zooms (mid-drag), cross-tierlist duplication, undo.
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const rect = (sel, i = 0) => ev(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,l:r.x,w:r.width,h:r.height}})()`);
const setZoom = (z) => ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.x=15;c.camera.y=0;c.camera.zoom=${z};return 1})()`);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=Date.now();
 const rows=(p)=>[{id:p+'S',name:'S',color:'#FF4B5C',cards:[{id:p+'k1',kind:'text',text:'One'},{id:p+'k2',kind:'text',text:'Two'}]},{id:p+'A',name:'A',color:'#FFB347',cards:[]}];
 b.addNote({id:'t1',type:'tierlist',name:'T1',text:'',x:-35,y:-30,width:60,height:null,createdAt:n,tiers:rows('a')});
 b.addNote({id:'t2',type:'tierlist',name:'T2',text:'',x:35,y:-30,width:60,height:null,createdAt:n+1,tiers:[{id:'bS',name:'S',color:'#FF4B5C',cards:[]},{id:'bA',name:'A',color:'#FFB347',cards:[{id:'bk',kind:'text',text:'Other'}]}]});return 1})()`);
async function indicatorAt(zoom) {
  await setZoom(zoom); await wait(300);
  const card = await rect('[data-tier-card-id="ak1"]'); const rowA = await rect('[data-tier-row-cards]', 1);
  await mouse("mouseMoved", card.x, card.y); await mouse("mousePressed", card.x, card.y, "left", 1);
  for (let i = 1; i <= 8; i += 1) { await mouse("mouseMoved", card.x + (rowA.l + 6 - card.x) * i / 8, card.y + (rowA.y - card.y) * i / 8, "left", 1); await wait(20); }
  const ind = await rect('[data-tier-insertion-indicator]'); const cardH = card.h;
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await mouse("mouseReleased", rowA.l + 6, rowA.y, "left", 0); await wait(200);
  return ind ? { zoom, indicatorH: Math.round(ind.h), cardH: Math.round(cardH), ratio: +(ind.h / cardH).toFixed(2) } : { zoom, indicator: null };
}
console.log("indicator zoom 0.5:", JSON.stringify(await indicatorAt(0.5)));
console.log("indicator zoom 1.5:", JSON.stringify(await indicatorAt(1.5)));
const tiers = () => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return ['t1','t2'].map(i=>b.board.notes[i].tiers.map(r=>r.name+':'+r.cards.map(c=>c.text??c.id).join(',')).join(' ')).join(' || ')})()`);
console.log("after cancels:", await tiers());
await setZoom(0.8); await wait(300);
const k2 = await rect('[data-tier-card-id="ak2"]'); const t2S = await rect('[data-tier-row-cards]', 2);
await mouse("mouseMoved", k2.x, k2.y); await mouse("mousePressed", k2.x, k2.y, "left", 1);
for (let i = 1; i <= 12; i += 1) { await mouse("mouseMoved", k2.x + (t2S.x - k2.x) * i / 12, k2.y + (t2S.y - k2.y) * i / 12, "left", 1); await wait(20); }
await mouse("mouseReleased", t2S.x, t2S.y, "left", 0); await wait(300);
console.log("after cross drag (Two copied to T2 S):", await tiers());
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 }); await wait(300);
console.log("after undo:", await tiers());
const del = await ev(`(()=>{const b=document.querySelector('[data-tier-card-id="ak1"] button');if(!b)return null;const r=b.getBoundingClientRect();const s=b.querySelector('svg')?.getBoundingClientRect();return s?{btnCx:r.x+r.width/2,btnCy:r.y+r.height/2,svgCx:s.x+s.width/2,svgCy:s.y+s.height/2}:'no svg'})()`);
console.log("delete cross centring:", JSON.stringify(del));
ws.close();
