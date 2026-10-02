// Debug 19 smoke (after 1.4.4): YouTube RMB menu anywhere + drag + loop/frame items + Space, PDF zoom independent of board zoom, hidden-header drag strip, dictaphone drag-out, white media colours.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mouseMoved" ? 0 : 1 });
const pos = (expr) => ev(`(()=>{const e=${expr};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,t:r.top,l:r.left,w:r.width,h:r.height}})()`);
const click = async (p, button = "left") => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, button, button === "left" ? 1 : 2); await mouse("mouseReleased", p.x, p.y, button, 0); await wait(300); };
const drag = async (a, dx, dy, modifiers = 0) => { await mouse("mouseMoved", a.x, a.y, "none", 0, modifiers); await mouse("mousePressed", a.x, a.y, "left", 1, modifiers); for (let i = 1; i <= 10; i++) { await mouse("mouseMoved", a.x + dx * i / 10, a.y + dy * i / 10, "left", 1, modifiers); await wait(30); } await mouse("mouseReleased", a.x + dx, a.y + dy, "left", 0, modifiers); await wait(500); };
const key = async (k, code, vk, modifiers = 0, text) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, text }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(250); };
const shot = async (n) => writeFileSync(`C:/Users/reteren/AppData/Local/Temp/claude/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const menu = () => ev(`[...document.querySelectorAll('[role=menu]')].filter(m=>m.offsetWidth).map(m=>[...m.querySelectorAll('button,[role=menuitem]')].filter(b=>b.offsetWidth).map(b=>b.innerText.replace(/\\s+/g,' ').trim()).filter(Boolean).join(' | ')).join(' || ')`);
const esc = async () => { await key("Escape", "Escape", 27); await click({ x: 1200, y: 770 }); };
const note = (type, expr) => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.order.map(i=>b.board.notes[i]).find(x=>x.type==='${type}');return n?${expr}:'none'})()`);

await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');const h=await import('/src/history/history.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);h.clear();cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=1;
 const l=await import('/src/youtube/logic.ts');const a=await import('/src/youtube/actions.svelte.ts');a.createYouTubeNote(l.parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ').ref,{x:-25,y:-5});return 1})()`);
await wait(2500);
// 2: RMB in the centre of the YouTube node
const yt = await pos(`document.querySelector('[data-youtube-node]')`);
await click({ x: yt.x, y: yt.y }, "right"); await wait(250);
console.log("2 RMB centre (thumbnail) menu:", await menu());
await esc();
// start the player, then RMB over the embed
await click({ x: yt.x, y: yt.y }); await wait(1500);
console.log("   after click: iframe", await ev(`!!document.querySelector('[data-youtube-node] iframe')`), "capture layer", await ev(`!!document.querySelector('[data-youtube-capture]')`));
await click({ x: yt.x, y: yt.y }, "right"); await wait(250);
const m2 = await menu(); console.log("2 RMB over playing video menu:", m2);
// 3/4 items
const loopBtn = await pos(`[...document.querySelectorAll('[role=menu] button,[role=menuitem]')].find(b=>b.offsetWidth&&/loop/i.test(b.innerText))`);
if (loopBtn) { await click(loopBtn); console.log("3 loop:", await note("youtube", "n.youtube.loop")); }
await click({ x: yt.x, y: yt.y }, "right"); await wait(250);
const frameBtn = await pos(`[...document.querySelectorAll('[role=menu] button,[role=menuitem]')].find(b=>b.offsetWidth&&/frame/i.test(b.innerText))`);
if (frameBtn) { await click(frameBtn); await wait(300); console.log("4 frameHidden:", await note("youtube", "n.frameHidden"), "| header visible:", await ev(`(()=>{const h=document.querySelector('[data-youtube-node]')?.closest('article')?.querySelector('header');return h?getComputedStyle(h).display:'no header'})()`)); }
await shot("d19-yt-frameless");
// 5: drag from the video area
const before = await note("youtube", "n.x.toFixed(1)+','+n.y.toFixed(1)");
const yt2 = await pos(`document.querySelector('[data-youtube-node]')`);
await drag({ x: yt2.x, y: yt2.y }, 120, 40);
console.log("5 drag over video moves node:", before, "->", await note("youtube", "n.x.toFixed(1)+','+n.y.toFixed(1)"));
// 8: Space over YouTube (should not jump camera)
const cam = () => ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');return c.camera.x.toFixed(1)+','+c.camera.y.toFixed(1)})()`);
const yt3 = await pos(`document.querySelector('[data-youtube-node]')`);
await mouse("mouseMoved", yt3.x, yt3.y); const c0 = await cam(); await key(" ", "Space", 32, 0, " ");
console.log("8 Space over YouTube camera:", c0, "->", await cam());
// 1: PDF zoom independence
await ev(`(async()=>{const s=await import('/src/attachments/service.ts');const c=await import('/src/formats/formatCreation.ts');const st='%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF';const p=await s.importMediaFile(new File([st],'doc.pdf',{type:'application/pdf'}));c.createFormatNotes([p.media],{x:-20,y:40})})()`); await wait(1200);
const pdfState = () => ev(`(()=>{const a=document.querySelector('article[data-kind=pdf]');const f=a?.querySelector('iframe,embed');if(!f)return 'no frame';const nr=a.getBoundingClientRect(),fr=f.getBoundingClientRect();return 'frame/node width '+(fr.width/nr.width).toFixed(2)+' src#'+(f.src.split('#')[1]??'')+' | '+[...a.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')||b.innerText.trim()).join(',')})()`);
console.log("1 PDF at zoom 1:", await pdfState());
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=2})()`); await wait(600);
console.log("1 PDF at zoom 2:", await pdfState());
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1})()`); await wait(400);
const plus = await pos(`[...document.querySelectorAll('article[data-kind=pdf] button')].find(b=>/zoom in|\\+/i.test((b.getAttribute('aria-label')||'')+b.innerText))`);
if (plus) { await click(plus); console.log("1 after + pdfZoom:", await note("pdf", "n.pdfZoom")); }
// 13: hidden header drag strip on a text note
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');b.addNote({id:'hh',type:'note',name:'Hidden',text:'body text here',x:40,y:40,width:22,height:null,headerHidden:true,createdAt:Date.now()})})()`); await wait(500);
const strip = await pos(`document.querySelector('[data-note-id="hh"] [data-header-drag-strip]')`);
console.log("13 strip:", strip ? Math.round(strip.w) + "x" + Math.round(strip.h) : "none");
if (strip) { const b0 = await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.hh.x})()`); await drag({ x: strip.x, y: strip.y }, 60, 0); console.log("13 drag by hidden header x:", b0, "->", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.hh.x})()`)); }
await shot("d19-all");
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
