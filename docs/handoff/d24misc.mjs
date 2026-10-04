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
// debug 24: text tool, selection Ctrl-move + outline at zoom-out, point cursor, pipette cursor, no Alt overview in draw.
const drag = async (pts, mods = 0) => { await mouse("mouseMoved", pts[0][0], pts[0][1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1, modifiers: mods }); for (const [x, y] of pts.slice(1)) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, modifiers: mods }); await wait(10); } const l = pts.at(-1); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: l[0], y: l[1], button: "left", buttons: 0, clickCount: 1, modifiers: mods }); await wait(700); };
const line = (x1, y1, x2, y2, n = 16) => Array.from({ length: n + 1 }, (_, i) => [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
const hist = () => ev(`(async()=>{const h=await import('/src/history/history.svelte.ts');return h.history.entries.length+':'+(h.history.entries.at(-1)?.label??'')})()`);
await send("Page.reload"); await wait(2500);
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1;c.camera.x=0;c.camera.y=0;(await import('/src/history/history.svelte.ts')).clear()})()`);
await mouse("mouseMoved", 700, 500); await key("d", "KeyD", 68, 2);
// Alt overview blocked in draw mode
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, modifiers: 1 }); await wait(300);
console.log("1 Alt in draw: overview", await ev(`document.body.dataset.altOverview ?? 'off'`));
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, modifiers: 0 }); await wait(200);
// text tool
await ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings({size:40,opacity:1,color:'#f0c040'})})()`);
await key("t", "KeyT", 84);
console.log("2 tool:", await ev(`(async()=>(await import('/src/drawing/tools.svelte.ts')).drawingTools.active)()`), "| hardness hidden", await ev(`![...document.querySelectorAll('[data-draw-toolbar] .field span')].some(s=>s.textContent.startsWith('Hardness'))`));
await click(450, 300); await wait(300);
await send("Input.insertText", { text: "Hello" }); await wait(200);
await key("Enter", "Enter", 13, 2); await wait(800);
console.log("2 text committed: hist", await hist(), "| alpha in text", await alphaAt(470, 315));
await shot("d24-text");
// selection + Ctrl move from inside
await ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings({size:30,hardness:1,color:'#e04040'})})()`);
await key("b", "KeyB", 66); await drag(line(400, 500, 800, 500));
await key("m", "KeyM", 77); await drag(line(380, 470, 820, 530, 8));
await drag(line(600, 500, 600, 600, 10), 2);
console.log("3 Ctrl-move from inside: old", await alphaAt(600, 500), "| new", await alphaAt(600, 600), "| hist", await hist());
await mouse("mouseMoved", 900, 300); await shot("d24-point-cursor");
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=0.08})()`); await wait(400);
await shot("d24-outline-far");
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1})()`); await wait(300);
// pipette cursor while RMB held
await mouse("mouseMoved", 700, 700);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 700, y: 700, button: "right", buttons: 2, clickCount: 1 }); await wait(250);
console.log("4 pipette cursor:", await ev(`!!document.querySelector('[data-eyedropper-cursor]')`));
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 700, y: 700, button: "right", buttons: 0, clickCount: 1 }); await wait(200);
console.log("errors:", errors);
process.exit(0);
