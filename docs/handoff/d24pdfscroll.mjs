// PDF scroll latency on the user's real 16-page file: scroll with the wheel and count how often a page that is
// visible in the node has no rendered bitmap yet (that is what the user sees as "slides load with a delay").
import { readFileSync } from "node:fs";
const PDF = "C:/Users/reteren/Downloads/flokkun lífvera2_kerfin.pdf";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
await ev(`window.__pdfB64=${JSON.stringify(readFileSync(PDF).toString("base64"))};1`);
console.log(await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=1;
 const bytes=Uint8Array.from(atob(window.__pdfB64),c=>c.charCodeAt(0));const s=await import('/src/attachments/service.ts');const c=await import('/src/formats/formatCreation.ts');const p=await s.importMediaFile(new File([bytes],'flokkun.pdf',{type:'application/pdf'}));const ids=c.createFormatNotes([p.media],{x:0,y:0});const n=b.board.notes[ids[0]];n.width=60;n.height=50;n.x=-30;n.y=-25;window.__pdf=ids[0];return 'ok'})()`));
await wait(3500);
const sc = await ev(`(()=>{const d=document.querySelector('[data-note-id="'+window.__pdf+'"] .pdf-document');const r=d.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: sc.x, y: sc.y });
let blankSamples = 0, samples = 0;
for (let step = 0; step < 40; step++) {
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: sc.x, y: sc.y, deltaX: 0, deltaY: 180 });
  await wait(90);
  const r = await ev(`(()=>{const d=document.querySelector('[data-note-id="'+window.__pdf+'"] .pdf-document');const v=d.getBoundingClientRect();let blank=0,vis=0;for(const p of d.querySelectorAll('.pdf-page')){const r=p.getBoundingClientRect();if(r.bottom<v.top||r.top>v.bottom)continue;vis++;const c=p.querySelector('canvas');if(!c||c.width===0)blank++}return [vis,blank,d.scrollTop,d.scrollHeight]})()`);
  samples += r[0]; blankSamples += r[1];
  if (r[2] + 10 >= r[3] - 360) break;
}
console.log(`visible page samples: ${samples}, unrendered: ${blankSamples} (${(100 * blankSamples / Math.max(1, samples)).toFixed(1)}%)`);
ws.close();
