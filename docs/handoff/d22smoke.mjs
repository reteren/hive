// Debug 22 smoke (after 1.4.7): image Opacity… popover, PDF +/-/Fit width re-render + vertical resize, Format node scrollbar.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
const pos = (expr) => ev(`(()=>{const e=${expr};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,l:r.left,w:r.width}})()`);
const click = async (p, button = "left") => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, button, button === "left" ? 1 : 2); await mouse("mouseReleased", p.x, p.y, button, 0); await wait(300); };
const drag = async (a, dx, dy) => { await mouse("mouseMoved", a.x, a.y); await mouse("mousePressed", a.x, a.y, "left", 1); for (let i = 1; i <= 10; i++) { await mouse("mouseMoved", a.x + dx * i / 10, a.y + dy * i / 10, "left", 1); await wait(30); } await mouse("mouseReleased", a.x + dx, a.y + dy, "left", 0); await wait(400); };
const shot = async (n) => writeFileSync(`C:/Users/reteren/AppData/Local/Temp/claude/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');const h=await import('/src/history/history.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);h.clear();cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=1;
 const cv=document.createElement('canvas');cv.width=200;cv.height=120;const x=cv.getContext('2d');x.fillStyle='#3a6ea5';x.fillRect(0,0,200,120);const bl=await new Promise(r=>cv.toBlob(r,'image/png'));const a=await import('/src/images/imageActions.ts');await a.importImageFiles([new File([bl],'pic.png',{type:'image/png'})],{x:-35,y:-15});
 const s=await import('/src/attachments/service.ts');const c=await import('/src/formats/formatCreation.ts');const st='%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF';const p=await s.importMediaFile(new File([st],'doc.pdf',{type:'application/pdf'}));c.createFormatNotes([p.media],{x:20,y:-10});
 const t=await s.importMediaFile(new File([Array.from({length:60},(_,i)=>'{\"line\": '+i+', \"value\": \"some longer text to make the row wide enough for horizontal scroll\"}').join('\\n')],'data.json',{type:'application/json'}));c.createFormatNotes([t.media],{x:-35,y:25});return 1})()`);
await wait(1500);
// 1: Opacity
const img = await pos(`document.querySelector('article[data-kind=image]')`);
await click(img, "right"); await wait(250);
const op = await pos(`[...document.querySelectorAll('[role=menu] button,[role=menuitem]')].find(b=>b.offsetWidth&&/opacity/i.test(b.innerText))`);
console.log("1 menu has Opacity…:", !!op);
if (op) {
  await click(op); await wait(300);
  const slider = await pos(`document.querySelector('[data-image-opacity-popover] input[type=range]')`);
  console.log("1 slider:", !!slider);
  if (slider) { await click({ x: slider.l + slider.w * 0.3, y: slider.y }); await wait(300); }
  console.log("1 opacity:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.order.map(i=>b.board.notes[i]).find(n=>n.type==='image').opacity})()`), "| picture opacity css:", await ev(`(()=>{const a=document.querySelector('article[data-kind=image]');const p=a.querySelector('.image-node-picture-viewport,.image-node-picture,img');let e=p;while(e&&e!==a){if(getComputedStyle(e).opacity!=='1')return getComputedStyle(e).opacity;e=e.parentElement}return getComputedStyle(a).opacity+' (card)'})()`));
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}
await shot("d22-opacity");
// 2: PDF zoom buttons
const pdfSrc = () => ev(`(()=>{const f=document.querySelector('article[data-kind=pdf] iframe,article[data-kind=pdf] embed');return (f?(f.src.split('#')[1]??''):'none')+' | '+document.querySelector('article[data-kind=pdf] output')?.textContent})()`);
console.log("2 before:", await pdfSrc());
const plus = await pos(`[...document.querySelectorAll('article[data-kind=pdf] button')].find(b=>b.getAttribute('aria-label')==='Zoom in')`);
if (plus) { await click(plus); await wait(400); console.log("2 after +:", await pdfSrc()); }
const fit = await pos(`[...document.querySelectorAll('article[data-kind=pdf] button')].find(b=>/fit width/i.test(b.innerText))`);
if (fit) { await click(fit); await wait(400); console.log("2 after Fit width:", await pdfSrc()); }
// vertical resize
await ev(`(async()=>{const s=await import('/src/selection/selection.svelte.ts');const b=await import('/src/model/board.svelte.ts');const id=b.board.order.find(i=>b.board.notes[i].type==='pdf');(s.selectOnly??s.setSelection??(()=>{}))(id)})()`); await click(await pos(`document.querySelector('article[data-kind=pdf] header')`)); await wait(300);
const bh = await pos(`document.querySelector('[data-resize-handle="bottom"]')`);
const h0 = await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.order.map(i=>b.board.notes[i]).find(n=>n.type==='pdf');return n.height})()`);
if (bh) await drag(bh, 0, 80);
console.log("2 vertical resize height:", h0, "->", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.order.map(i=>b.board.notes[i]).find(n=>n.type==='pdf');return n.height})()`));
// 3: Format scroller
await click({ x: 1200, y: 640 });
console.log("3 format scroller:", await ev(`(()=>{const a=document.querySelector('article[data-kind=format]');const s=a?.querySelector('.cm-scroller');if(!s)return 'no scroller';return 'sh/ch '+s.scrollHeight+'/'+s.clientHeight+' sw/cw '+s.scrollWidth+'/'+s.clientWidth+' overflow '+getComputedStyle(s).overflow})()`));
await shot("d22-all");
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
