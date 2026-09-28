// Statistics inserted into List as a right-side extension: drag in, rows aligned, click does nothing, drag out, Undo.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const at = (sel, i = 0) => ev(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,l:r.left,r:r.right,t:r.top,b:r.bottom}})()`);
const drag = async (from, to, steps = 12) => { await mouse("mouseMoved", from.x, from.y); await mouse("mousePressed", from.x, from.y, "left", 1); for (let i = 1; i <= steps; i += 1) { await mouse("mouseMoved", from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, "left", 1); await wait(25); } await mouse("mouseReleased", to.x, to.y, "left", 0); await wait(400); };
const key = async (k, code, vk, mods = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await wait(300); };
const state = () => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const l=await import('/src/model/links.svelte.ts');const st=Object.values(b.board.notes).filter(n=>n.type==='stats');return JSON.stringify({listStats:!!b.board.notes.ls.listStats,listWidth:b.board.notes.ls.width,statsNodes:st.length,linked:Object.values(l.links.byId).filter(k=>st.some(s=>s.id===k.from||s.id===k.to)).length})})()`);

await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 b.addNote({id:'n1',type:'note',name:'Alpha',text:'one two three',x:-60,y:-35,width:20,height:null,createdAt:n});
 b.addNote({id:'ls',type:'list',name:'List',text:'',x:-30,y:-20,width:30,height:null,createdAt:n+1,listItems:[{id:'r1',targetId:'n1',label:'Alpha'},{id:'r2',targetId:null,label:'plain text row'},{id:'r3',targetId:null,label:'third'}]});
 b.addNote({id:'st',type:'stats',name:'Statistics',text:'',x:-30,y:12,width:30,height:null,createdAt:n+2});
 c.camera.x=-5;c.camera.y=0;c.camera.zoom=1.1;return 1})()`);
await wait(600);
console.log("before:", await state());
await drag(await at('[data-note-id="st"] [data-note-header]'), await at('[data-note-id="ls"] [data-list-row="r2"]'));
console.log("after drop on List:", await state());
const card = await at('[data-note-id="ls"]'); const ext = await at('[data-list-stats-extension]');
console.log("extension:", !!ext, ext && `ext left ${Math.round(ext.l)} vs list card right ${Math.round(card.r)} / card left ${Math.round(card.l)}`);
const rows = await ev(`JSON.stringify([...document.querySelectorAll('[data-note-id="ls"] [data-list-row]')].map((r,i)=>{const s=document.querySelectorAll('[data-list-stats-row]')[i];const a=r.getBoundingClientRect(),b=s?.getBoundingClientRect();return b?Math.round(a.top-b.top)+'/'+Math.round(a.height-b.height):'none'}))`);
console.log("row vs stats row (dTop/dHeight px):", rows, "texts:", await ev(`[...document.querySelectorAll('[data-list-stats-row]')].map(e=>e.textContent.replace(/\s+/g,' ').trim()).join(' | ')`));
writeFileSync(process.argv[2].replace(".png", "-in.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
// click without movement on header: nothing
const hdr = await at('[data-list-stats-header]');
await mouse("mouseMoved", hdr.x, hdr.y); await mouse("mousePressed", hdr.x, hdr.y, "left", 1); await mouse("mouseReleased", hdr.x, hdr.y, "left", 0); await wait(300);
console.log("after click on header:", await state());
// move the List: width must not grow
const lh = await at('[data-note-id="ls"] [data-note-header]');
await drag(lh, { x: lh.x + 40, y: lh.y + 10 });
console.log("after moving List:", await state());
// pull out by header
const hdr2 = await at('[data-list-stats-header]');
await drag(hdr2, { x: hdr2.x + 200, y: hdr2.y + 150 }, 14);
console.log("after pull-out:", await state());
await key("z", "KeyZ", 90, 2);
console.log("after Ctrl+Z:", await state());
await key("z", "KeyZ", 90, 2);
console.log("after 2nd Ctrl+Z:", await state());
console.log("errors:", errors.length ? errors.join(" || ") : "none");
writeFileSync(process.argv[2], Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
ws.close();
