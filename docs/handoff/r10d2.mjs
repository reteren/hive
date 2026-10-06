import { writeFileSync } from "node:fs";
const OUT = "C:/Users/reteren/AppData/Local/Temp/claude";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page" && t.url.includes("1450"));
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 220)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
const click = async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); await wait(300); };
const key = async (k, code, vk, modifiers = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(250); };
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const alphaAt = (sx, sy) => ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');const cm=await import('/src/board/cameraMath.ts');const h=await import('/src/drawing/history.ts');const t=await import('/src/drawing/types.ts');const b=document.querySelector('.board').getBoundingClientRect();const w=cm.screenToWorld(cam.camera,cam.viewport??(await import('/src/board/camera.svelte.ts')).viewport,{x:${sx}-b.left,y:${sy}-b.top});const px=Math.floor(w.x*t.DRAW_PX_PER_UNIT),py=Math.floor(w.y*t.DRAW_PX_PER_UNIT);const img=h.readRasterRect(px,py,1,1);return img.data[3]})()`);
const drag = async (pts, mods = 0) => { await mouse("mouseMoved", pts[0][0], pts[0][1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1, modifiers: mods }); for (const [x, y] of pts.slice(1)) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, modifiers: mods }); await wait(10); } const l = pts.at(-1); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: l[0], y: l[1], button: "left", buttons: 0, clickCount: 1, modifiers: mods }); await wait(600); };
const line = (x1, y1, x2, y2, n = 16) => Array.from({ length: n + 1 }, (_, i) => [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
const sel = () => ev(`(async()=>{const a=(await import('/src/drawing/selection.svelte.ts')).drawingSelection.area;return a?a.x+','+a.y+' '+a.width+'x'+a.height:'none'})()`);
const hist = () => ev(`(async()=>{const h=await import('/src/history/history.svelte.ts');return h.history.entries.length+':'+(h.history.entries.at(-1)?.label??'')})()`);
const countInk = (x, y, w, h) => ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');const cm=await import('/src/board/cameraMath.ts');const hh=await import('/src/drawing/history.ts');const t=await import('/src/drawing/types.ts');const b=document.querySelector('.board').getBoundingClientRect();const a=cm.screenToWorld(cam.camera,cam.viewport,{x:${x}-b.left,y:${y}-b.top});const c=cm.screenToWorld(cam.camera,cam.viewport,{x:${x+w}-b.left,y:${y+h}-b.top});const px=Math.floor(a.x*t.DRAW_PX_PER_UNIT),py=Math.floor(a.y*t.DRAW_PX_PER_UNIT),pw=Math.max(1,Math.floor((c.x-a.x)*t.DRAW_PX_PER_UNIT)),ph=Math.max(1,Math.floor((c.y-a.y)*t.DRAW_PX_PER_UNIT));const img=hh.readRasterRect(px,py,pw,ph);let n=0;for(let i=3;i<img.data.length;i+=4)if(img.data[i]>8)n++;return n})()`);
const frameProbe = async (fn) => { await ev(`window.__ft=[];(function loop(t){window.__ft.push(t);window.__fr=requestAnimationFrame(loop)})(performance.now())`); await fn(); return ev(`(()=>{cancelAnimationFrame(window.__fr);const f=window.__ft;const d=f.slice(1).map((t,i)=>t-f[i]);d.sort((a,b)=>a-b);return 'frames '+d.length+' median '+d[Math.floor(d.length/2)].toFixed(1)+'ms p95 '+d[Math.floor(d.length*0.95)].toFixed(1)+'ms'})()`); };
const tool = (id) => ev(`(async()=>{const m=await import('/src/drawing/tools.svelte.ts');(m.setDrawingTool??m.selectDrawingTool??((x)=>{m.drawingTools.active=x}))('${id}');return m.drawingTools.active})()`);
await send("Page.reload"); await wait(2500);
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1;c.camera.x=0;c.camera.y=0;(await import('/src/history/history.svelte.ts')).clear()})()`);
await mouse("mouseMoved", 700, 500); await key("d", "KeyD", 68, 2);
await ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings({size:12,hardness:1,opacity:1,color:'#e04040'})})()`);
// --- Shape: rectangle outline, commit with Enter
await key("u", "KeyU", 85); console.log("tool after U:", await ev(`(async()=>(await import('/src/drawing/tools.svelte.ts')).drawingTools.active)()`));
const h0 = await hist();
await drag(line(400, 250, 600, 400));
console.log("shape preview:", await ev(`!!document.querySelector('[data-shape-preview="true"], [data-shape-preview]')`), "| ink before commit", await countInk(390, 240, 220, 170));
await key("Enter", "Enter", 13); await wait(700);
console.log("shape committed ink", await countInk(390, 240, 220, 170), "| hist", h0, "->", await hist());
await shot("r10-shape");
// --- Spray: hold still 1.2 s
await key("y", "KeyY", 89);
const sprayBefore = await countInk(760, 280, 120, 120);
await mouse("mouseMoved", 820, 340); await send("Input.dispatchMouseEvent",{type:"mousePressed",x:820,y:340,button:"left",buttons:1,clickCount:1}); await wait(500);
const spray1 = await countInk(760, 280, 120, 120); await wait(700);
const spray2 = await countInk(760, 280, 120, 120);
await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:820,y:340,button:"left",buttons:0,clickCount:1}); await wait(600);
console.log("spray hold: preview only during hold", spray1, spray2, "| committed ink", await countInk(760, 280, 120, 120), "| hist", await hist());
await shot("r10-spray");
// --- Brush tips: draw a stroke with each
await key("b", "KeyB", 66);
const tips = await ev(`[...document.querySelectorAll('[data-brush-tip-option]')].map(b=>b.dataset.brushTipOption||b.textContent.trim()).join(',')`);
console.log("brush tips:", tips);
let y = 470;
for (const tip of tips.split(",").filter(Boolean)) {
  await ev(`(()=>{const b=[...document.querySelectorAll('[data-brush-tip-option]')].find(b=>(b.dataset.brushTipOption||b.textContent.trim())===${JSON.stringify(tip)});b?.click();return 1})()`); await wait(150);
  await drag(line(400, y, 640, y + 10, 20)); y += 40;
}
await shot("r10-tips");
// --- Effects: blur over the red rectangle edge, frame timing
await key("j", "KeyJ", 74);
console.log("effect choices:", await ev(`[...document.querySelectorAll('[data-effect-choice]')].map(b=>b.dataset.effectChoice||b.textContent.trim()).join(',')`));
const hb = await hist();
const ft = await frameProbe(async () => { await drag(line(380, 250, 620, 250, 40)); });
console.log("blur drag:", ft, "| hist", hb, "->", await hist());
await shot("r10-blur");
// big-board stroke timing with the brush (round)
await key("b", "KeyB", 66);
console.log("brush stroke timing:", await frameProbe(async () => { await drag(line(300, 650, 1100, 700, 80)); }));
await key("z", "KeyZ", 90, 2); await wait(400);
console.log("after one Undo:", await hist());
console.log("errors:", errors.slice(0,5));
process.exit(0);
