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
// debug 23: Alt overview in draw mode (p.2), browser eyedropper fallback, smoothed brush at zoom 0.1 / 3.
const drag = async (pts, button = "left") => { const bs = button === "left" ? 1 : 2; await mouse("mouseMoved", pts[0][0], pts[0][1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button, buttons: bs, clickCount: 1 }); for (const [x, y] of pts.slice(1)) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button, buttons: bs }); await wait(12); } const l = pts.at(-1); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: l[0], y: l[1], button, buttons: 0, clickCount: 1 }); await wait(1200); };
const curve = (cx, cy, r, n = 24) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(i / n * Math.PI * 1.5), cy + r * Math.sin(i / n * Math.PI * 1.5)]);
await send("Page.reload"); await wait(2500);
await mouse("mouseMoved", 700, 600); await key("d", "KeyD", 68, 2);
await ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings({size:40,opacity:1,hardness:0,color:'#e04040'})})()`);
// Alt hold
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, modifiers: 1 }); await wait(300);
console.log("1 Alt held: overview", await ev(`document.body.dataset.altOverview`), "| cursor visible", await ev(`(()=>{const c=document.querySelector('[data-draw-cursor]');return c?getComputedStyle(c).visibility:'none'})()`));
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, modifiers: 0 }); await wait(300);
console.log("1 Alt up: overview", await ev(`document.body.dataset.altOverview`), "| tool", await ev(`(async()=>(await import('/src/tools/tool.svelte.ts')).tool.active+'/'+(await import('/src/drawing/tools.svelte.ts')).drawingTools.active)()`));
// curves at zoom 1, 0.1, 3
for (const z of [1, 0.1, 3]) {
  await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=${z};c.camera.x=0;c.camera.y=0})()`); await wait(300);
  await drag(curve(600, 450, 120));
  await shot(`d23-curve-${z}`);
}
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1})()`); await wait(400);
// eyedropper browser fallback: RMB hold on the stroke then release
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 720, y: 450 });
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 720, y: 450, button: "right", buttons: 2, clickCount: 1 }); await wait(200);
console.log("2 eyedropper preview:", await ev(`document.querySelector('[data-eyedropper]')?.textContent.trim()`), "| cursor hidden", await ev(`!document.querySelector('[data-draw-cursor]')`));
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 720, y: 450, button: "right", buttons: 0, clickCount: 1 }); await wait(300);
console.log("2 brush colour after pick:", await ev(`(async()=>(await import('/src/drawing/tools.svelte.ts')).drawingTools.brush.color)()`), "| menu opened", await ev(`!!document.querySelector('[role=menu]')`));
console.log("errors:", errors);
process.exit(0);
