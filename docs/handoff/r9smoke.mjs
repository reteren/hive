// R9 delivery 1 smoke: board image (layer, size, Ctrl-resize, GIF still/animated), paste routing (board / Tierlist row / editor), inline image, undo.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0, clickCount) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: clickCount ?? (type === "mousePressed" || type === "mouseReleased" ? 1 : 0) });
const pos = (expr) => ev(`(()=>{const e=${expr};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
const click = async (p, count = 1) => { await mouse("mouseMoved", p.x, p.y); for (let c = 1; c <= count; c++) { await mouse("mousePressed", p.x, p.y, "left", 1, 0, c); await mouse("mouseReleased", p.x, p.y, "left", 0, 0, c); } await wait(300); };
const drag = async (a, dx, dy, modifiers = 0) => { await mouse("mouseMoved", a.x, a.y, "none", 0, modifiers); await mouse("mousePressed", a.x, a.y, "left", 1, modifiers); for (let i = 1; i <= 10; i++) { await mouse("mouseMoved", a.x + dx * i / 10, a.y + dy * i / 10, "left", 1, modifiers); await wait(25); } await mouse("mouseReleased", a.x + dx, a.y + dy, "left", 0, modifiers); await wait(400); };
const key = async (k, code, vk, modifiers = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(300); };
const shot = async (n) => writeFileSync(`C:/Users/reteren/AppData/Local/Temp/claude/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));

await ev(`window.__png=async(w,h,c)=>{const cv=document.createElement('canvas');cv.width=w;cv.height=h;const x=cv.getContext('2d');x.fillStyle=c;x.fillRect(0,0,w,h);x.fillStyle='#fff';x.fillRect(w/4,h/4,w/2,h/2);const b=await new Promise(r=>cv.toBlob(r,'image/png'));return new File([b],'pic-'+c.slice(1)+'.png',{type:'image/png'})};
 window.__gif=()=>new File([Uint8Array.from(atob('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='),c=>c.charCodeAt(0))],'dot.gif',{type:'image/gif'});
 window.__paste=async(target,file)=>{const dt=new DataTransfer();dt.items.add(await file);const e=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});(target||document.body).dispatchEvent(e);return e.defaultPrevented};1`);
const images = () => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.order.filter(i=>b.board.notes[i].type==='image').map(i=>{const n=b.board.notes[i];return n.name+' '+n.width.toFixed(1)+'x'+n.height.toFixed(1)})})()`);
const imgNodes = `[...document.querySelectorAll('.notes-world [data-note-id]')].filter(e=>e.querySelector('.image-node-picture'))`;

console.log(await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');const h=await import('/src/history/history.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);h.clear();
 b.addNote({id:'txt',type:'note',name:'Note 1',text:'Text above image',x:-5,y:-5,width:24,height:null,createdAt:Date.now()});cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=1;
 const a=await import('/src/images/imageActions.ts');await a.importImageFiles([await __png(400,200,'#3a6ea5')],{x:0,y:0});return 'setup ok'})()`));
await wait(600);
console.log("1 images:", await images());
console.log("1 layer:", await ev(`(()=>{const all=[...document.querySelectorAll('.notes-world [data-note-id]')];const i=all.findIndex(e=>e.querySelector('.image-node-picture'));const t=all.findIndex(e=>e.dataset.noteId==='txt');const tr=document.querySelector('[data-note-id="txt"]').getBoundingClientRect();const hit=document.elementFromPoint(tr.x+tr.width/2,tr.y+10)?.closest('[data-note-id]')?.dataset.noteId;return 'imgIdx '+i+' txtIdx '+t+' hitOnOverlap='+hit})()`));
await shot("r9-board");

const ip = await pos(`${imgNodes}[0]`);
await click({ x: ip.x + ip.w / 2 - 12, y: ip.y + ip.h / 2 - 12 });
const rh = await pos(`document.querySelector('[data-resize-handle="right"]')`);
console.log("2 right handle:", !!rh);
if (rh) {
  await drag(rh, 120, 0, 2); console.log("2 after Ctrl-resize:", await images());
  await drag(await pos(`document.querySelector('[data-resize-handle="right"]')`), -80, 0, 0); console.log("2 after free resize:", await images());
}

await ev(`(async()=>{const a=await import('/src/images/imageActions.ts');await a.importImageFiles([__gif()],{x:40,y:-20});})()`); await wait(1500);
await click({ x: 20, y: 760 });
const gifState = () => ev(`(()=>{const g=${imgNodes}.filter(e=>e.querySelector('canvas')).pop();if(!g)return 'no gif node';const c=g.querySelector('canvas'),i=g.querySelector('img');const vis=(el)=>!el.hidden&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';return 'canvas '+(vis(c)?'shown':'hidden')+', img '+(vis(i)?'shown':'hidden')})()`);
console.log("3 gif unselected:", await gifState());
await click(await pos(`${imgNodes}.filter(e=>e.querySelector('canvas')).pop()`));
console.log("3 gif selected:", await gifState());
await click({ x: 20, y: 760 });

const before = (await images()).length;
console.log("4 paste on board prevented:", await ev(`__paste(null,__png(120,120,'#a53a3a'))`)); await wait(700);
console.log("4 images", before, "->", (await images()).length);

console.log(await ev(`(async()=>{const c=await import('/src/notes/noteCommands.ts');const b=await import('/src/model/board.svelte.ts');const t=c.createNoteKind('tierlist');b.board.notes[t].x=-70;b.board.notes[t].y=-35;window.__tier=t;return 'tier created'})()`)); await wait(600);
const row = await pos(`document.querySelector('[data-note-id="'+window.__tier+'"] [data-tier-row-cards]')`);
await mouse("mouseMoved", row.x, row.y); await wait(200);
const imgsBefore = (await images()).length;
console.log("5 tier paste prevented:", await ev(`__paste(null,__png(160,90,'#3aa56e'))`)); await wait(800);
console.log("5 tier cards:", await ev(`[...document.querySelectorAll('[data-note-id="'+window.__tier+'"] [data-tier-card-kind]')].map(e=>e.dataset.tierCardKind).join(',')`), "| board images", imgsBefore, "->", (await images()).length);
await shot("r9-tier");

await mouse("mouseMoved", 5, 5);
await click(await pos(`document.querySelector('[data-note-id="txt"] [data-note-body]')`), 2); await wait(300);
console.log("6 editing:", await ev(`!!document.activeElement?.closest('.cm-editor')`));
await key("End", "End", 35, 2);
console.log("6 editor paste prevented:", await ev(`__paste(document.activeElement,__png(300,150,'#8a5ab0'))`)); await wait(900);
console.log("6 text:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.txt.text.replace(/[0-9a-f]{64}/,'<hash>')})()`), "| widget:", await ev(`!!document.querySelector('[data-inline-image-widget]')`), "| board images:", (await images()).length);
await shot("r9-inline-edit");
await key("Escape", "Escape", 27); await click({ x: 20, y: 760 });
console.log("6 preview width %:", await ev(`(()=>{const i=document.querySelector('[data-note-id="txt"] [data-inline-image]');if(!i)return 'none';const col=i.closest('[data-note-body]').getBoundingClientRect().width;return Math.round(i.getBoundingClientRect().width/col*100)})()`));
await shot("r9-inline");

for (let k = 0; k < 3; k++) await key("z", "KeyZ", 90, 2);
console.log("7 after 3x undo: token:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.txt.text.includes('att:')})()`), "tier image cards:", await ev(`document.querySelectorAll('[data-note-id="'+window.__tier+'"] [data-tier-card-kind="image"]').length`), "images:", (await images()).length);
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
