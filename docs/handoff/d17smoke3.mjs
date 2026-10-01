// Debug 17 smoke (after 1.4.0): RMB menu contents for note / image / GIF / beacon / zone, Scale-Grab-Delete from the menu, zone Grab -> zone move mode, Tierlist card for a board image target.
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
const pos = (expr) => ev(`(()=>{const e=${expr};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
const click = async (p, button = "left") => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, button, button === "left" ? 1 : 2); await mouse("mouseReleased", p.x, p.y, button, 0); await wait(350); };
const shot = async (n) => writeFileSync(`C:/Users/reteren/AppData/Local/Temp/claude/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const menuText = () => ev(`[...document.querySelectorAll('[role=menu]')].filter(m=>m.offsetWidth).map(m=>[...m.querySelectorAll('button,[role=menuitem]')].filter(b=>b.offsetWidth).map(b=>b.innerText.replace(/\\s+/g,' ').trim()).filter(Boolean).join(' | ')).join(' || ')`);
const esc = async () => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await wait(250); await click({ x: 1200, y: 760 }); };
await ev(`window.__png=async()=>{const cv=document.createElement('canvas');cv.width=300;cv.height=150;const x=cv.getContext('2d');x.fillStyle='#3a6ea5';x.fillRect(0,0,300,150);x.fillStyle='#fff';x.fillRect(0,0,100,50);const b=await new Promise(r=>cv.toBlob(r,'image/png'));return new File([b],'photo.png',{type:'image/png'})};
 window.__gif=()=>new File([Uint8Array.from(atob('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='),c=>c.charCodeAt(0))],'anim.gif',{type:'image/gif'});1`);
console.log(await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/notes/noteCommands.ts');const cam=await import('/src/board/camera.svelte.ts');const h=await import('/src/history/history.svelte.ts');const z=await import('/src/zones/zones.svelte.ts').catch(()=>null);for(const i of [...b.board.order])b.removeNote(i);h.clear();cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=1;
 b.addNote({id:'n1',type:'note',name:'Note 1',text:'hello',x:-55,y:-30,width:20,height:null,createdAt:Date.now()});
 const a=await import('/src/images/imageActions.ts');await a.importImageFiles([await __png()],{x:-15,y:-20});await a.importImageFiles([__gif()],{x:15,y:-20});
 const bc=c.createNoteKind('beacon');b.board.notes[bc].x=40;b.board.notes[bc].y=-25;window.__beacon=bc;
 const zc=await import('/src/zones/commands.ts');const zone=zc.createZone({x:-50,y:10,width:40,height:20});window.__zone=zone?.id;return 'setup zone='+(zone?'ok':'null')+' zonesModule='+!!z})()`));
await wait(1200);
const imgs = await ev(`[...document.querySelectorAll('article[data-kind=image]')].map(a=>a.dataset.noteId+(a.querySelector('[data-gif-file]')?':gif':':png')).join(',')`);
const [pngId, gifId] = imgs.split(",").map((s) => s.split(":")[0]);
const items = [["note", `document.querySelector('[data-note-id="n1"]')`], ["image", `document.querySelector('[data-note-id="${pngId}"]')`], ["gif", `document.querySelector('[data-note-id="${gifId}"]')`], ["beacon", `document.querySelector('[data-beacon-id="'+window.__beacon+'"],[data-note-id="'+window.__beacon+'"]')`]];
for (const [name, sel] of items) {
  const p = await pos(sel);
  if (!p) { console.log(name, "not found"); continue; }
  await click(p, "right"); await wait(200);
  console.log(`1/3 ${name} menu:`, await menuText());
  await esc();
}
const zp = await pos(`document.querySelector('[data-zone-id="'+window.__zone+'"] path,[data-zone-id="'+window.__zone+'"]')`);
if (zp) { await click(zp, "right"); await wait(200); console.log("3 zone menu:", await menuText()); }
await shot("d17-zone-menu");
// zone Grab from the menu
const grab = await pos(`[...document.querySelectorAll('[role=menu] button')].find(b=>b.offsetWidth&&/^Grab/.test(b.innerText.trim()))`);
if (grab) { await click(grab); await wait(300); console.log("3 zone Grab -> zoneMode:", await ev(`(async()=>{const z=await import('/src/zones/zoneMode.svelte.ts');return JSON.stringify({active:z.zoneMode.active,move:!!z.zoneMode.moveRequest,follow:z.zoneMode.followMoveActive})})()`)); }
await esc();
// note Grab: move with pointer then click to drop
const np = await pos(`document.querySelector('[data-note-id="n1"]')`);
const before = await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.n1.x.toFixed(1)})()`);
await click(np, "right"); await wait(200);
const g2 = await pos(`[...document.querySelectorAll('[role=menu] button,[role=menuitem]')].find(b=>b.offsetWidth&&/^Grab/.test(b.innerText.trim()))`);
if (g2) { await click(g2); for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", g2.x + i * 10, g2.y); await wait(30); } await click({ x: g2.x + 80, y: g2.y }); }
console.log("3 note Grab moved x:", before, "->", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.n1?.x.toFixed(1)})()`));
// Delete from menu on the PNG image
await click(await pos(`document.querySelector('[data-note-id="${pngId}"]')`), "right"); await wait(200);
const del = await pos(`[...document.querySelectorAll('[role=menu] button,[role=menuitem]')].find(b=>b.offsetWidth&&/^Delete/.test(b.innerText.trim()))`);
if (del) await click(del);
console.log("3 Delete image -> exists:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return !!b.board.notes['${pngId}']})()`));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 }); await wait(300);
console.log("3 after Ctrl+Z exists:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return !!b.board.notes['${pngId}']})()`));
// Tierlist card with an image target
console.log(await ev(`(async()=>{const c=await import('/src/notes/noteCommands.ts');const b=await import('/src/model/board.svelte.ts');const t=c.createNoteKind('tierlist');const n=b.board.notes[t];n.x=-60;n.y=40;n.tiers[0].cards.push({id:'c1',kind:'note',noteId:'${pngId}'},{id:'c2',kind:'note',noteId:'${gifId}'});window.__tier=t;return 'tier'})()`)); await wait(800);
console.log("4 tier cards:", await ev(`[...document.querySelectorAll('[data-note-id="'+window.__tier+'"] [data-tier-card-id]')].map(c=>c.dataset.tierCardId+':'+(c.querySelector('img,canvas')?'picture':'text "'+c.innerText.replace(/\\s+/g,' ').trim()+'"')).join(' ; ')`));
await ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');cam.camera.x=-20;cam.camera.y=30})()`); await wait(400);
await shot("d17-tier");
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
