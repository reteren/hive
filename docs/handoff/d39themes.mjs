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
await send("Page.reload"); await wait(3000);
const ids = JSON.parse(await ev(`(async()=>JSON.stringify((await import('/src/theme/appearance.svelte.ts')).allThemePresets().map(p=>p.id)))()`));
console.log("presets:", ids.join(", "));
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1;c.camera.x=0;c.camera.y=0;b.addNote({id:'n1',type:'note',name:'Note',text:'some **bold** text',x:-60,y:20,width:30,height:null,color:null,createdAt:Date.now()});const s=await import('/src/selection/selection.svelte.ts');s.selectOnly('n1');return 1})()`);
await wait(500);
await mouse("mouseMoved", 900, 300); await key("q","KeyQ",81); await wait(400);
for (const id of ["light","paper","skyblue"]) {
  await ev(`(async()=>{(await import('/src/theme/appearance.svelte.ts')).applyThemePreset(${JSON.stringify(id)});return 1})()`);
  await wait(350);
  const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 70, clip: { x: 0, y: 500, width: 700, height: 300, scale: 1 } });
  writeFileSync(`C:/Users/reteren/AppData/Local/Temp/claude/theme-${id}.jpg`, Buffer.from(s.result.data, "base64"));
}
await ev(`(async()=>{(await import('/src/theme/appearance.svelte.ts')).resetThemeToHive();return 1})()`);
console.log("errors", errors); process.exit(0);
