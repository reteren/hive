// R10 smoke part 2: smooth stroke edge at large size + selection (rect move moves only the selected piece, Delete, undo).
import { writeFileSync } from "node:fs";
const OUT = "C:/Users/reteren/AppData/Local/Temp/claude";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, buttons = 0, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? (buttons ? "left" : "none") : "left", buttons, modifiers, clickCount: type === "mouseMoved" ? 0 : 1 });
const key = async (k, code, vk, modifiers = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(200); };
const line = (x1, y1, x2, y2, n = 25) => Array.from({ length: n + 1 }, (_, i) => [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
const drag = async (pts, modifiers = 0) => { await mouse("mouseMoved", pts[0][0], pts[0][1], 0, modifiers); await mouse("mousePressed", pts[0][0], pts[0][1], 1, modifiers); for (const [x, y] of pts.slice(1)) { await mouse("mouseMoved", x, y, 1, modifiers); await wait(10); } const l = pts.at(-1); await mouse("mouseReleased", l[0], l[1], 0, modifiers); await wait(1500); };
const alphaAt = (sx, sy) => ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');const cm=await import('/src/board/cameraMath.ts');const h=await import('/src/drawing/history.ts');const t=await import('/src/drawing/types.ts');const b=document.querySelector('.board').getBoundingClientRect();const w=cm.screenToWorld(cam.camera,cam.viewport,{x:${sx}-b.left,y:${sy}-b.top});return h.readRasterRect(Math.floor(w.x*t.DRAW_PX_PER_UNIT),Math.floor(w.y*t.DRAW_PX_PER_UNIT),1,1).data[3]})()`);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const cam=await import('/src/board/camera.svelte.ts');const h=await import('/src/history/history.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);h.clear();cam.camera.x=0;cam.camera.y=0;cam.camera.zoom=1;const s=await import('/src/drawing/tileStore.svelte.ts');await s.drawingTileStore.replaceFromSnapshot(new Map());const t=await import('/src/tools/tool.svelte.ts');if(t.tool.active!=='draw'){window.dispatchEvent(new KeyboardEvent('keydown',{key:'d',code:'KeyD',ctrlKey:true,bubbles:true}));await new Promise(r=>setTimeout(r,200))}const d=await import('/src/drawing/tools.svelte.ts');d.setActiveDrawTool('brush');d.setBrushSettings({opacity:1,hardness:1,size:60,color:'#e8a33a'});return t.tool.active})()`);
// big stroke for edge smoothness
await drag(line(340, 200, 760, 300, 30));
const clip = await send("Page.captureScreenshot", { format: "png", clip: { x: 300, y: 150, width: 500, height: 200, scale: 2 } });
writeFileSync(`${OUT}/r10-edge.png`, Buffer.from(clip.result.data, "base64"));
// a long horizontal thin stroke; select its right half and move it down
await ev(`(async()=>{const d=await import('/src/drawing/tools.svelte.ts');d.setBrushSettings({size:10,color:'#40a0ff'})})()`);
await drag(line(250, 450, 750, 450));
await key("m", "KeyM", 77);
console.log("tool:", await ev(`(async()=>{const d=await import('/src/drawing/tools.svelte.ts');return d.drawingTools.active})()`));
await drag(line(520, 420, 780, 480, 10));
console.log("selection:", await ev(`(async()=>!!(await import("/src/drawing/selection.svelte.ts")).drawingSelection.area)()`));
await drag(line(650, 450, 650, 560, 12));
console.log("move: left part stays", await alphaAt(350, 450), "| right part moved from", await alphaAt(650, 450), "to", await alphaAt(650, 560));
await key("Escape", "Escape", 27);
await wait(500);
console.log("after commit (Esc): left", await alphaAt(350, 450), "moved", await alphaAt(650, 560), "| draw mode still:", await ev(`(async()=>{const t=await import('/src/tools/tool.svelte.ts');return t.tool.active})()`));
await key("z", "KeyZ", 90, 2); await wait(800);
console.log("undo move: back at", await alphaAt(650, 450), "moved spot", await alphaAt(650, 560));
// select left part and delete
await key("d", "KeyD", 68, 2); await wait(200);
const mode = await ev(`(async()=>{const t=await import('/src/tools/tool.svelte.ts');if(t.tool.active!=='draw'){window.dispatchEvent(new KeyboardEvent('keydown',{key:'d',code:'KeyD',ctrlKey:true,bubbles:true}));await new Promise(r=>setTimeout(r,200))}const d=await import('/src/drawing/tools.svelte.ts');d.setActiveDrawTool('select-rect');return t.tool.active+'/'+d.drawingTools.active})()`);
console.log("mode:", mode);
await drag(line(300, 420, 400, 480, 8));
await key("Delete", "Delete", 46); await wait(800);
console.log("delete: selected gone", await alphaAt(350, 450), "outside kept", await alphaAt(500, 450));
await send("Page.captureScreenshot", { format: "png" }).then((s) => writeFileSync(`${OUT}/r10-select.png`, Buffer.from(s.result.data, "base64")));
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
