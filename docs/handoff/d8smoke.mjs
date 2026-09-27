// Debug 8 smoke: app renders, List live drag, Statistics linked to List, Mark as insert, resize-handle rules, Map ctrl+wheel, Inbox rows.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0, ...extra });
const click = async (p) => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, "left", 1); await mouse("mouseReleased", p.x, p.y, "left", 0); await wait(250); };
const at = (sel, i = 0) => ev(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,h:r.height}})()`);

console.log("rendered:", await ev(`document.body.innerHTML.length > 1000`));
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const l=await import('/src/model/links.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 b.addNote({id:'n1',type:'note',name:'Alpha',text:'one two three',x:-100,y:-45,width:25,height:null,createdAt:n});
 b.addNote({id:'bc',type:'beacon',name:'Hub',text:'',x:-100,y:-10,width:7.2,height:7.2,color:'#c85a5a',createdAt:n+1});
 l.addLink({id:'b1',from:'bc',to:'n1',kind:'strong',shape:'base'});
 b.addNote({id:'ls',type:'list',name:'List',text:'',x:-55,y:-45,width:30,height:null,createdAt:n+2,listItems:[{id:'r1',targetId:'n1',label:'Alpha'},{id:'r2',targetId:'bc',label:'Hub'},{id:'r3',targetId:null,label:'plain text row'}]});
 b.addNote({id:'st',type:'stats',name:'Statistics',text:'',x:-15,y:-45,width:30,height:null,createdAt:n+3});
 l.addLink({id:'sl',from:'st',to:'ls',kind:'strong',shape:'base'});
 b.addNote({id:'mk',type:'markas',name:'Mark as',text:'',x:25,y:-45,width:14,height:null,createdAt:n+4,customMarks:[{id:'m1',text:'urgent',color:'#ff4b5c'},{id:'m2',text:'idea',color:'#5cd8ff'}],customMarkFrame:true});
 b.addNote({id:'n2',type:'note',name:'Target',text:'x',x:25,y:-10,width:25,height:null,createdAt:n+5});
 b.addNote({id:'mp',type:'map',name:'Map',text:'',x:55,y:-45,width:40,height:30,createdAt:n+6});
 c.camera.x=-10;c.camera.y=-15;c.camera.zoom=0.85;return 1})()`);
await wait(700);
console.log("stats list view:", await ev(`[...document.querySelectorAll('[data-note-id="st"] [data-stats-list-row]')].map(e=>e.textContent.replace(/\\s+/g,' ').trim()).join(' | ')`));
console.log("list icons:", await ev(`[...document.querySelectorAll('[data-note-id="ls"] [data-list-kind-icon]')].map(e=>e.getAttribute('data-list-kind-icon')||e.getAttribute('title')).join(',')`));
// live drag row 1 below row 3
const r1 = await at('[data-note-id="ls"] [data-list-reorder]', 0); const r3 = await at('[data-note-id="ls"] [data-list-reorder]', 2);
if (r1 && r3) {
  await mouse("mouseMoved", r1.x, r1.y); await mouse("mousePressed", r1.x, r1.y, "left", 1);
  for (let i = 1; i <= 8; i += 1) { await mouse("mouseMoved", r1.x, r1.y + (r3.y + r3.h * 0.6 - r1.y) * i / 8, "left", 1); await wait(25); }
  console.log("ghost opacity mid-drag:", await ev(`(()=>{const g=document.querySelector('[data-list-drag-ghost]');return g?getComputedStyle(g).opacity:'no ghost'})()`));
  await mouse("mouseReleased", r1.x, r3.y + r3.h * 0.6, "left", 0); await wait(300);
}
console.log("list order after drag:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.ls.listItems.map(i=>i.label).join(',')})()`));
// Mark as frame on its own node
console.log("markas frame attr:", await ev(`document.querySelector('[data-note-id="mk"]')?.getAttribute('data-custom-mark-frame')`));
// drag Mark as onto Target note
const mk = await at('[data-note-id="mk"] [data-note-header]'); const tg = await at('[data-note-id="n2"]');
if (mk && tg) { await mouse("mouseMoved", mk.x, mk.y); await mouse("mousePressed", mk.x, mk.y, "left", 1); for (let i = 1; i <= 10; i += 1) { await mouse("mouseMoved", mk.x + (tg.x - mk.x) * i / 10, mk.y + (tg.y - mk.y) * i / 10, "left", 1); await wait(20); } await mouse("mouseReleased", tg.x, tg.y, "left", 0); await wait(350); }
console.log("target marks after insert:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return JSON.stringify({marks:(b.board.notes.n2?.customMarks??[]).map(m=>m.text),markNodeGone:!b.board.notes.mk})})()`));
// resize handles per kind
for (const [nid, label] of [["st", "stats"], ["mp", "map"], ["ls", "list"]]) {
  const h = await at(`[data-note-id="${nid}"] [data-note-header]`); if (h) await click(h);
  console.log(label, "handles:", await ev(`[...document.querySelectorAll('[data-resize-handle]')].map(e=>e.getAttribute('data-resize-handle')).join(',')||'none'`));
}
// map ctrl+wheel zoom on node
const mv = await at('[data-note-id="mp"] [data-map-view]');
const z0 = await ev(`document.querySelector('[data-note-id="mp"] [data-map-view]')?.getAttribute('data-map-internal-zoom')`);
if (mv) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: mv.x, y: mv.y, deltaX: 0, deltaY: -120, modifiers: 2 }); await wait(300); }
console.log("map internal zoom before/after ctrl+wheel:", z0, await ev(`document.querySelector('[data-note-id="mp"] [data-map-view]')?.getAttribute('data-map-internal-zoom')`), "links drawn:", await ev(`document.querySelectorAll('[data-note-id="mp"] [data-map-link-kind]').length`));
console.log("errors:", errors.length ? errors.join(" || ") : "none");
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(process.argv[2], Buffer.from(shot.result.data, "base64"));
ws.close();
