// Scale locks: handles per kind, List bottom only with >7 rows, note cannot shrink below base width.
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const click = async (p) => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, "left", 1); await mouse("mouseReleased", p.x, p.y, "left", 0); await wait(300); };
const at = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const handles = () => ev(`[...document.querySelectorAll('[data-resize-handle]')].map(e=>e.getAttribute('data-resize-handle')).join(',')||'none'`);
const rows = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: 'r' + i, targetId: null, label: 'row ' + i })));
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 b.addNote({id:'l7',type:'list',name:'List7',text:'',x:-75,y:-35,width:30,height:null,createdAt:n,listItems:${rows(7)}});
 b.addNote({id:'l8',type:'list',name:'List8',text:'',x:-40,y:-35,width:30,height:null,createdAt:n+1,listItems:${rows(8)}});
 b.addNote({id:'tl',type:'tierlist',name:'Tier',text:'',x:-5,y:-35,width:60,height:null,createdAt:n+2,tiers:[{id:'rS',name:'S',color:'#e58b83',cards:[]}]});
 b.addNote({id:'mk',type:'markas',name:'Mark as',text:'',x:-5,y:5,width:30,height:null,createdAt:n+3});
 b.addNote({id:'nt',type:'note',name:'Note',text:'x',x:30,y:5,width:30,height:null,createdAt:n+4});
 b.addNote({id:'mp',type:'map',name:'Map',text:'',x:-75,y:25,width:40,height:30,createdAt:n+5});
 c.camera.x=-10;c.camera.y=5;c.camera.zoom=0.75;return 1})()`);
await wait(700);
for (const [nid, label] of [["l7", "List 7 rows"], ["l8", "List 8 rows"], ["tl", "Tierlist"], ["mk", "Mark as"], ["nt", "Note"], ["mp", "Map"]]) {
  await click(await at(`[data-note-id="${nid}"] [data-note-header]`));
  console.log(label, "handles:", await handles());
}
// try to shrink the note from its right edge by 150px
await click(await at('[data-note-id="nt"] [data-note-header]'));
const rh = await at('[data-resize-handle="right"]');
if (rh) { await mouse("mouseMoved", rh.x, rh.y); await mouse("mousePressed", rh.x, rh.y, "left", 1); for (let i = 1; i <= 10; i += 1) { await mouse("mouseMoved", rh.x - i * 15, rh.y, "left", 1); await wait(25); } await mouse("mouseReleased", rh.x - 150, rh.y, "left", 0); await wait(300); }
console.log("note width after shrinking attempt (base 30):", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.nt.width})()`));
// widen then list bottom drag
await click(await at('[data-note-id="l8"] [data-note-header]'));
const bh = await at('[data-resize-handle="bottom"]'); const h0 = await ev(`Math.round(document.querySelector('[data-note-id="l8"]').getBoundingClientRect().height)`);
if (bh) { await mouse("mouseMoved", bh.x, bh.y); await mouse("mousePressed", bh.x, bh.y, "left", 1); for (let i = 1; i <= 6; i += 1) { await mouse("mouseMoved", bh.x, bh.y + i * 15, "left", 1); await wait(25); } await mouse("mouseReleased", bh.x, bh.y + 90, "left", 0); await wait(300); }
console.log("List 8 height px before/after bottom drag:", h0, await ev(`Math.round(document.querySelector('[data-note-id="l8"]').getBoundingClientRect().height)`), "width:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.l8.width})()`));
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
