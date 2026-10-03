// Debug 23 PDF verification on the user's real file: load, render quality at several board zooms (screenshots), backing resolution, zoom buttons, scroll, flicker check.
import { readFileSync, writeFileSync } from "node:fs";
const PDF = "C:/Users/reteren/Downloads/flokkun lífvera2_kerfin.pdf";
const OUT = "C:/Users/reteren/AppData/Local/Temp/claude";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = []; const logs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (m.method === "Runtime.consoleAPICalled" && /warn|error/.test(m.params.type)) logs.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 160)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const b64 = readFileSync(PDF).toString("base64");
await ev(`window.__pdfB64=${JSON.stringify(b64)};1`);
console.log(await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');const h=await import('/src/history/history.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);h.clear();cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=1;
 const bytes=Uint8Array.from(atob(window.__pdfB64),c=>c.charCodeAt(0));const s=await import('/src/attachments/service.ts');const c=await import('/src/formats/formatCreation.ts');const p=await s.importMediaFile(new File([bytes],'flokkun.pdf',{type:'application/pdf'}));if(!p.ok)return p.error;const ids=c.createFormatNotes([p.media],{x:0,y:0});const n=b.board.notes[ids[0]];n.width=60;n.height=50;n.x=-30;n.y=-25;window.__pdf=ids[0];return 'created '+n.width+'x'+n.height})()`));
await wait(4000);
const state = () => ev(`(()=>{const a=document.querySelector('[data-note-id="'+window.__pdf+'"]');const cs=[...a.querySelectorAll('canvas')];const vis=cs.filter(c=>c.width>0);return 'pages '+cs.length+' rendered '+vis.length+(vis[0]?' backing '+vis[0].width+'x'+vis[0].height+' css '+vis[0].style.width+'x'+vis[0].style.height:'')+' | msg '+(a.querySelector('.pdf-message')?.textContent??'-')})()`);
console.log("load:", await state());
const shotClip = async (name) => { const r = await ev(`(()=>{const a=document.querySelector('[data-note-id="'+window.__pdf+'"]');const r=a.getBoundingClientRect();return {x:Math.max(0,r.x),y:Math.max(0,r.y),w:Math.min(innerWidth,r.width),h:Math.min(innerHeight,r.height)}})()`); const s = await send("Page.captureScreenshot", { format: "png", clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.result.data, "base64")); };
for (const z of [0.5, 1, 2, 3.5]) {
  await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=${z};const b=await import('/src/model/board.svelte.ts');const n=b.board.notes[window.__pdf];c.camera.x=n.x+n.width/2;c.camera.y=n.y+12})()`);
  await wait(250);
  const during = await state();
  await wait(1200);
  console.log(`zoom ${z}: 250ms after: ${during} || settled: ${await state()}`);
  await shotClip(`d23-pdf-z${z}`);
}
// buttons
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1;const b=await import('/src/model/board.svelte.ts');const n=b.board.notes[window.__pdf];c.camera.x=n.x+n.width/2;c.camera.y=n.y+n.height/2})()`); await wait(1200);
const lbl = () => ev(`document.querySelector('[data-note-id="'+window.__pdf+'"] output')?.textContent`);
const btn = (label) => ev(`(()=>{const b=[...document.querySelectorAll('[data-note-id="'+window.__pdf+'"] button')].find(b=>b.getAttribute('aria-label')==='${label}');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const click = async (p) => { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y }); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", buttons: 0, clickCount: 1 }); await wait(700); };
console.log("label:", await lbl()); await click(await btn("Zoom in")); console.log("after +:", await lbl(), await state());
await click(await btn("Zoom out")); await click(await btn("Zoom out")); console.log("after −−:", await lbl(), await state());
await click(await btn("Fit width")); console.log("after Fit:", await lbl());
// wheel scroll inside
const sc = await ev(`(()=>{const d=document.querySelector('[data-note-id="'+window.__pdf+'"] .pdf-document');const r=d.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
for (let k = 0; k < 4; k++) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: sc.x, y: sc.y, deltaX: 0, deltaY: 300 }); await wait(120); }
await wait(1200);
console.log("scrollTop:", await ev(`document.querySelector('[data-note-id="'+window.__pdf+'"] .pdf-document').scrollTop`), "| camera zoom:", await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');return c.camera.zoom})()`), "|", await state());
await shotClip("d23-pdf-scrolled");
console.log("errors:", errors.length ? errors.join(" || ") : "none");
console.log("console warn/error:", logs.slice(0, 8).join(" || ") || "none");
ws.close();
