// Debug 9 smoke: Smooth lines (RMB, only X anchors, spacing/corners), List add (mouse + keyboard), Tierlist live drag, Source auto height.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const click = async (p, button = "left") => { const b = button === "left" ? 1 : 2; await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, button, b); await mouse("mouseReleased", p.x, p.y, button, 0); await wait(250); };
const at = (sel, i = 0) => ev(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
const type = async (text) => { for (const ch of text) await send("Input.insertText", { text: ch }); await wait(80); };
const enter = async () => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await wait(250); };
const setCam = (x, y, zoom) => ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.x=${x};c.camera.y=${y};c.camera.zoom=${zoom};return 1})()`);

// ---------- Smooth lines ----------
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const l=await import('/src/model/links.svelte.ts');const n=Date.now();
 b.addNote({id:'X',type:'note',name:'X',text:'hub',x:-10,y:-6,width:20,height:null,createdAt:n});
 const ys=[-14,-9,-4,1,6];ys.forEach((y,i)=>b.addNote({id:'o'+i,type:'note',name:'O'+i,text:'',x:30,y,width:12,height:null,createdAt:n+1+i}));
 l.addLink({id:'k0',from:'X',to:'o0',kind:'strong',shape:'base',fromAnchor:{x:1,y:0.5},toAnchor:{x:0,y:0.2}});
 l.addLink({id:'k1',from:'o1',to:'X',kind:'strong',shape:'base',fromAnchor:{x:0,y:0.7},toAnchor:{x:1,y:0.5}});
 l.addLink({id:'k2',from:'X',to:'o2',kind:'strong',shape:'base',fromAnchor:{x:1,y:0.5},toAnchor:{x:0,y:0.5}});
 l.addLink({id:'k3',from:'o3',to:'X',kind:'strong',shape:'base',fromAnchor:{x:0,y:0.1},toAnchor:{x:1,y:0}});
 l.addLink({id:'k4',from:'X',to:'o4',kind:'strong',shape:'base',fromAnchor:{x:1,y:1},toAnchor:{x:0,y:0.9}});
 return 1})()`);
await setCam(10, -4, 1.4); await wait(500);
const otherBefore = await ev(`(async()=>{const l=await import('/src/model/links.svelte.ts');return JSON.stringify(Object.values(l.links.byId).filter(k=>k.id.startsWith('k')).map(k=>k.from==='X'?k.toAnchor:k.fromAnchor))})()`);
await click(await at('[data-note-id="X"] [data-note-header]'), "right"); await wait(300);
const item = await ev(`(()=>{const e=[...document.querySelectorAll('button,[role=menuitem]')].find(b=>b.textContent.trim().startsWith('Smooth lines'));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
console.log("smooth menu item found:", !!item);
if (item) await click(item);
const geo = await ev(`(async()=>{const l=await import('/src/model/links.svelte.ts');const lay=await import('/src/notes/layout.svelte.ts');const b=await import('/src/model/board.svelte.ts');
 const B=lay.noteBounds(b.board.notes.X);const ks=Object.values(l.links.byId).filter(k=>k.id.startsWith('k'));
 const pts=ks.map(k=>{const a=k.from==='X'?k.fromAnchor:k.toAnchor;return {x:B.x+a.x*B.width,y:B.y+a.y*B.height}});
 let minGap=1e9;for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++)minGap=Math.min(minGap,Math.hypot(pts[i].x-pts[j].x,pts[i].y-pts[j].y));
 const corners=[[B.x,B.y],[B.x+B.width,B.y],[B.x,B.y+B.height],[B.x+B.width,B.y+B.height]];let minCorner=1e9;for(const p of pts)for(const c of corners)minCorner=Math.min(minCorner,Math.hypot(p.x-c[0],p.y-c[1]));
 return JSON.stringify({other:JSON.stringify(ks.map(k=>k.from==='X'?k.toAnchor:k.fromAnchor)),minGap:+minGap.toFixed(2),minCorner:+minCorner.toFixed(2),pts:pts.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ')})})()`);
const g = JSON.parse(geo);
console.log("smooth: other anchors unchanged:", g.other === otherBefore, "min gap u:", g.minGap, "min corner dist u:", g.minCorner, "points:", g.pts);
writeFileSync(process.argv[2].replace(".png", "-smooth.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');for(const id of ['X','o0','o1','o2','o3','o4'])b.removeNote?.(id);return 1})()`);

// ---------- List add ----------
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=Date.now();
 b.addNote({id:'ls',type:'list',name:'List',text:'',x:100,y:-20,width:30,height:null,createdAt:n,listItems:[]});
 b.addNote({id:'tA',type:'note',name:'Alpha target',text:'a',x:140,y:-20,width:20,height:null,createdAt:n+1});
 return 1})()`);
await setCam(125, -8, 1.2); await wait(500);
await click(await at('[data-note-id="ls"] [data-list-add]'));
const optIdx = await ev(`[...document.querySelectorAll('[data-note-id="ls"] [data-list-target-option]')].findIndex(e=>e.textContent.includes('Alpha target'))`);
console.log("list picker open:", !!(await at('[data-note-id="ls"] [data-list-search]')), "alpha option index:", optIdx);
if (optIdx >= 0) await click(await at('[data-note-id="ls"] [data-list-target-option]', optIdx));
await click(await at('[data-note-id="ls"] [data-list-add]'));
await click(await at('[data-note-id="ls"] [data-list-search]'));
await type("plain row"); await enter();
await click(await at('[data-note-id="ls"] [data-list-add]'));
await click(await at('[data-note-id="ls"] [data-list-search]'));
await type("second row"); await click(await at('[data-note-id="ls"] [data-list-add-text]'));
console.log("list items:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return JSON.stringify(b.board.notes.ls.listItems.map(i=>(i.targetId?'@':'')+i.label))})()`));

// ---------- Tierlist drag ----------
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');
 b.addNote({id:'tl',type:'tierlist',name:'Tier',text:'',x:100,y:20,width:60,height:null,createdAt:Date.now(),tiers:[
  {id:'rS',name:'S',color:'#e58b83',cards:[{id:'c1',kind:'text',text:'one'},{id:'c2',kind:'text',text:'two'},{id:'c3',kind:'text',text:'three'}]},
  {id:'rA',name:'A',color:'#e5bd67',cards:[{id:'c4',kind:'text',text:'four'}]}]});return 1})()`);
await setCam(130, 32, 1.2); await wait(500);
const c1 = await at('[data-note-id="tl"] [data-tier-card-id="c1"]'); const c3 = await at('[data-note-id="tl"] [data-tier-card-id="c3"]');
const c2x0 = (await at('[data-note-id="tl"] [data-tier-card-id="c2"]'))?.x;
if (c1 && c3) {
  await mouse("mouseMoved", c1.x, c1.y); await mouse("mousePressed", c1.x, c1.y, "left", 1);
  for (let i = 1; i <= 10; i += 1) { await mouse("mouseMoved", c1.x + (c3.x + c3.w * 0.4 - c1.x) * i / 10, c1.y, "left", 1); await wait(30); }
  await wait(250);
  console.log("tier mid-drag: ghost opacity:", await ev(`(()=>{const g=document.querySelector('[data-tier-drag-ghost]');return g?getComputedStyle(g).opacity:'no ghost'})()`),
    "slot:", !!(await at('[data-note-id="tl"] [data-tier-card-slot]')), "card two moved px:", Math.round(((await at('[data-note-id="tl"] [data-tier-card-id="c2"]'))?.x ?? 0) - c2x0));
  writeFileSync(process.argv[2].replace(".png", "-tier.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
  await mouse("mouseReleased", c3.x + c3.w * 0.4, c1.y, "left", 0); await wait(400);
}
console.log("tier S order:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.tl.tiers[0].cards.map(c=>c.text).join(',')})()`));

// ---------- Source auto height ----------
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');b.addNote({id:'sr',type:'source',name:'Source',text:'',x:100,y:60,width:34,height:null,createdAt:Date.now()});return 1})()`);
await setCam(117, 72, 1.2); await wait(500);
const hs0 = (await at('[data-note-id="sr"]'))?.h;
const desc = await at('[data-note-id="sr"] [data-source-description]');
console.log("source desc styles:", await ev(`(()=>{const t=document.querySelector('[data-note-id="sr"] [data-source-description]');const s=getComputedStyle(t);return s.resize+' overflowY='+s.overflowY})()`));
if (desc) { await click(desc); await type("line one"); for (let i = 0; i < 4; i += 1) { await enter(); await type("more text " + i); } }
await wait(300);
const hs1 = (await at('[data-note-id="sr"]'))?.h;
const scroll = await ev(`(()=>{const t=document.querySelector('[data-note-id="sr"] [data-source-description]');return t.scrollHeight-t.clientHeight})()`);
console.log("source height px empty/5 lines:", Math.round(hs0), Math.round(hs1), "textarea hidden overflow px:", scroll, "model height:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return String(b.board.notes.sr.height)})()`));
await click(await at('[data-note-id="sr"] [data-note-header]'));
console.log("source resize handles:", await ev(`[...document.querySelectorAll('[data-resize-handle]')].map(e=>e.getAttribute('data-resize-handle')).join(',')||'none'`));

console.log("errors:", errors.length ? errors.join(" || ") : "none");
writeFileSync(process.argv[2], Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
ws.close();
