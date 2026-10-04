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
// Drawing performance probe: big soft strokes, fill, fast pan at zoom-out. Prints frame stats.
const t0 = Date.now();
const frames = () => ev(`(()=>{const f=window.__frames||[];window.__frames=[];if(f.length<2)return 'n/a';const d=f.slice(1).map((t,i)=>t-f[i]);d.sort((a,b)=>a-b);return 'frames '+d.length+' median '+d[d.length>>1].toFixed(1)+' p95 '+d[Math.floor(d.length*0.95)].toFixed(1)+' max '+d.at(-1).toFixed(1)})()`);
const startFrames = () => ev(`(()=>{window.__frames=[];if(!window.__raf){window.__raf=1;const loop=t=>{(window.__frames||(window.__frames=[])).push(t);requestAnimationFrame(loop)};requestAnimationFrame(loop)}return 1})()`);
const hist = () => ev(`(async()=>{const h=await import('/src/history/history.svelte.ts');return h.history.entries.length})()`);
const waitHist = async (n, label) => { const s = Date.now(); while ((await hist()) < n && Date.now() - s < 20000) await wait(50); return Date.now() - s; };
const strokeMs = async (pts) => { await mouse("mouseMoved", pts[0][0], pts[0][1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", buttons: 1, clickCount: 1 }); const s = Date.now(); for (const [x, y] of pts.slice(1)) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 }); await ev("1"); } const moveMs = Date.now() - s; const l = pts.at(-1); const h0 = await hist(); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: l[0], y: l[1], button: "left", buttons: 0, clickCount: 1 }); const commitMs = await waitHist(h0 + 1); return { moveMs, perMove: (moveMs / (pts.length - 1)).toFixed(1), commitMs }; };
const wave = (y, n = 60) => Array.from({ length: n + 1 }, (_, i) => [330 + i * 950 / n, y + Math.sin(i / 6) * 120]);
await send("Page.reload"); await wait(2500);
await ev(`(async()=>{const h=await import('/src/history/history.svelte.ts');h.clear();const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1;c.camera.x=0;c.camera.y=0})()`);
await mouse("mouseMoved", 700, 500); await key("d", "KeyD", 68, 2);
await ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings({size:400,opacity:1,hardness:0,color:'#4080e0'})})()`);
await startFrames();
for (const y of [250, 450, 650]) console.log("big soft stroke y", y, JSON.stringify(await strokeMs(wave(y))), await frames());
await ev(`(async()=>{(await import('/src/drawing/tools.svelte.ts')).setBrushSettings({size:10,hardness:0.85})})()`);
console.log("small stroke", JSON.stringify(await strokeMs(wave(500))), await frames());
// fill
await key("f", "KeyF", 70);
const h0 = await hist();
const fs = Date.now();
await click(700, 120);
console.log("fill ms", await waitHist(h0 + 1), await frames());
await key("b", "KeyB", 66);
console.log("tiles", await ev(`(async()=>{const s=await import('/src/drawing/tileStore.svelte.ts');return s.drawingTileStore.allKeys().length+' levels '+s.drawingTileStore.levels().join(',')})()`));
// pan at zoom 0.2 rapidly via camera state each frame
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=0.2})()`); await wait(500);
await startFrames();
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');const s=performance.now();await new Promise(r=>{const step=t=>{const k=(t-s)/1000;c.camera.x=Math.sin(k*12)*800;c.camera.y=Math.cos(k*9)*500;if(t-s<2000)requestAnimationFrame(step);else r()};requestAnimationFrame(step)});return 1})()`);
console.log("pan at 0.2:", await frames());
await shot("gpu-after-perf");
console.log("total s", ((Date.now() - t0) / 1000).toFixed(1), "errors:", errors);
process.exit(0);
