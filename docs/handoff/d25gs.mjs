// debug 22 part 2: line/draw sub-tools unfold under their hotbar button; draw panel has no tool grid.
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
// G / S on the drawing selection: follow without a button, click commits, Esc cancels, one Undo.
const drag = async (pts, mods = 0) => { await mouse("mouseMoved", pts[0][0], pts[0][1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1, modifiers: mods }); for (const [x, y] of pts.slice(1)) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, modifiers: mods }); await wait(10); } const l = pts.at(-1); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: l[0], y: l[1], button: "left", buttons: 0, clickCount: 1, modifiers: mods }); await wait(600); };
const line = (x1, y1, x2, y2, n = 16) => Array.from({ length: n + 1 }, (_, i) => [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
const sel = () => ev(`(async()=>{const a=(await import('/src/drawing/selection.svelte.ts')).drawingSelection.area;return a?a.x+','+a.y+' '+a.width+'x'+a.height:'none'})()`);
const hist = () => ev(`(async()=>{const h=await import('/src/history/history.svelte.ts');return h.history.entries.length+':'+(h.history.entries.at(-1)?.label??'')})()`);
const glide = async (x0, y0, x1, y1) => { for (let i = 0; i <= 12; i++) { await mouse("mouseMoved", x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12); await wait(15); } };
await send("Page.reload"); await wait(2500);
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1;c.camera.x=0;c.camera.y=0;(await import('/src/history/history.svelte.ts')).clear()})()`);
await mouse("mouseMoved", 700, 500); await key("d", "KeyD", 68, 2);
await ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings({size:30,hardness:1,opacity:1,color:'#40c060'})})()`);
await drag(line(500, 400, 700, 400));
await drag(line(480, 370, 720, 430, 8), 2);
const s0 = await sel(); const h0 = await hist();
// G: follow, Esc cancels
await mouse("mouseMoved", 600, 400); await key("g", "KeyG", 71); await glide(600, 400, 600, 550);
await shot("d25-grab-held");
console.log("G live: preview pixels", await ev(`(()=>{const c=document.querySelector('[data-selection-fast-preview] canvas');if(!c)return 'none';const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n})()`));
await key("Escape", "Escape", 27); await wait(400);
console.log("G Esc: selection", await sel(), "same", (await sel()) === s0, "| pixels old place", await alphaAt(600, 400), "| hist", await hist(), "unchanged", (await hist()) === h0);
// G: commit by click
await mouse("mouseMoved", 600, 400); await key("g", "KeyG", 71); await glide(600, 400, 600, 550);
await click(600, 550); await wait(800);
console.log("G click: selection", await sel(), "| new place", await alphaAt(600, 550), "| old", await alphaAt(600, 400), "| hist", await hist());
await key("z", "KeyZ", 90, 2); await wait(600);
console.log("G undo: selection back", (await sel()) === s0, "| old place", await alphaAt(600, 400));
await key("z", "KeyZ", 90, 10); await wait(600);
// S: scale up 2x around centre and commit with Enter
const c = await ev(`(async()=>{const a=(await import('/src/drawing/selection.svelte.ts')).drawingSelection.area;const t=await import('/src/drawing/types.ts');const cam=await import('/src/board/camera.svelte.ts');const cm=await import('/src/board/cameraMath.ts');const ppu=t.levelPxPerUnit(a.level);const br=document.querySelector('.board').getBoundingClientRect();const p=cm.worldToScreen(cam.camera,cam.viewport,{x:(a.x+a.width/2)/ppu,y:(a.y+a.height/2)/ppu});return [p.x+br.left,p.y+br.top]})()`);
await mouse("mouseMoved", c[0] + 60, c[1]); await key("s", "KeyS", 83); await glide(c[0] + 60, c[1], c[0] + 120, c[1]);
await shot("d25-scale-held");
await key("Enter", "Enter", 13); await wait(800);
console.log("S Enter: selection", await sel(), "| hist", await hist());
await shot("d25-scale-done");
console.log("errors:", errors);
process.exit(0);
