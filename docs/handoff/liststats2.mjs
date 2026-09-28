// Statistics polish: dragged node on top of List rows, fitted extension width, total row opposite + Add.
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
const at = (sel, i = 0) => ev(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,l:r.left,r:r.right}})()`);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const l=await import('/src/model/links.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 b.addNote({id:'n1',type:'note',name:'Note 3',text:'one two three four five six seven eight nine ten eleven twelve thirteen',x:-70,y:-40,width:25,height:null,createdAt:n});
 b.addNote({id:'bc',type:'beacon',name:'Beacon',text:'',x:-70,y:-10,width:7.2,height:7.2,color:'#c85a5a',createdAt:n+1});
 b.addNote({id:'b2',type:'note',name:'x',text:'',x:-90,y:-10,width:10,height:null,createdAt:n+2});
 l.addLink({id:'q1',from:'bc',to:'n1',kind:'strong',shape:'base'});l.addLink({id:'q2',from:'bc',to:'b2',kind:'strong',shape:'base'});
 b.addNote({id:'ls',type:'list',name:'List 2',text:'',x:-30,y:-20,width:30,height:null,createdAt:n+3,listItems:[{id:'r1',targetId:'n1',label:'Note 3'},{id:'r2',targetId:'bc',label:'Beacon'},{id:'r3',targetId:null,label:'plain'}]});
 b.addNote({id:'st',type:'stats',name:'Statistics',text:'',x:-30,y:15,width:30,height:null,createdAt:n+4});
 c.camera.x=-10;c.camera.y=0;c.camera.zoom=1.1;return 1})()`);
await wait(700);
const from = await at('[data-note-id="st"] [data-note-header]'); const rm = await at('[data-note-id="ls"] [data-list-remove="r1"]');
await mouse("mouseMoved", from.x, from.y); await mouse("mousePressed", from.x, from.y, "left", 1);
const to = { x: rm.x + 40, y: rm.y - 10 };
for (let i = 1; i <= 12; i += 1) { await mouse("mouseMoved", from.x + (to.x - from.x) * i / 12, from.y + (to.y - from.y) * i / 12, "left", 1); await wait(25); }
await wait(200);
console.log("mid-drag: element at List row × belongs to:", await ev(`(()=>{const e=document.elementFromPoint(${rm.x},${rm.y});return e?.closest('[data-note-id]')?.getAttribute('data-note-id')})()`));
writeFileSync(process.argv[2].replace(".png", "-drag.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const mid = await at('[data-note-id="ls"] [data-list-row="r2"]');
for (let i = 1; i <= 6; i += 1) { await mouse("mouseMoved", to.x + (mid.x - to.x) * i / 6, to.y + (mid.y - to.y) * i / 6, "left", 1); await wait(25); }
await mouse("mouseReleased", mid.x, mid.y, "left", 0); await wait(500);
const ext = await at('[data-list-stats-extension]'); const card = await at('[data-note-id="ls"]');
console.log("inserted:", !!ext, "ext width px:", ext && Math.round(ext.w), "list card px:", Math.round(card.w), "zoom 1.1 → ext u:", ext && (ext.w / 11).toFixed(1));
console.log("total:", await ev(`document.querySelector('[data-list-stats-total]')?.textContent.replace(/\s+/g,' ').trim()`));
console.log("rows:", await ev(`[...document.querySelectorAll('[data-list-stats-row]')].map(e=>e.textContent.replace(/\s+/g,' ').trim()).join(' | ')`));
console.log("saved list width:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.ls.width})()`));
console.log("errors:", errors.length ? errors.join(" || ") : "none");
writeFileSync(process.argv[2], Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
ws.close();
