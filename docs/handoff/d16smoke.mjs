// 1.1.6 debug smoke: zone brush cursor, zone moving (Shift mode, Ctrl carry, RMB Move zone, G), anchored menus.
import { writeFileSync } from "node:fs";

const port = 9334;
const out = process.argv[2];
const page = (await fetch(`http://localhost:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0) =>
  send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const key = async (code, keyName, modifiers = 0) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", code, key: keyName, modifiers, windowsVirtualKeyCode: keyName === "Shift" ? 16 : keyName === "Enter" ? 13 : keyName.toUpperCase().charCodeAt(0) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: keyName, modifiers, windowsVirtualKeyCode: keyName === "Shift" ? 16 : keyName === "Enter" ? 13 : keyName.toUpperCase().charCodeAt(0) });
  await wait(120);
};
async function drag(x0, y0, x1, y1, modifiers = 0, button = "left") {
  const bits = button === "left" ? 1 : 2;
  await mouse("mouseMoved", x0, y0, "none", 0, modifiers);
  await mouse("mousePressed", x0, y0, button, bits, modifiers);
  for (let i = 1; i <= 10; i += 1) { await mouse("mouseMoved", x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10, button, bits, modifiers); await wait(16); }
  await mouse("mouseReleased", x1, y1, button, 0, modifiers);
  await wait(200);
}
const state = () => evaluate(`(async()=>{const z=await import('/src/model/zones.svelte.ts');const b=await import('/src/model/board.svelte.ts');
  return JSON.stringify({zone:z.zones.byId.z1?.parts[0][0], note:{x:b.board.notes.n1?.x,y:b.board.notes.n1?.y},
  cursor:!!document.querySelector('[data-zone-brush-cursor], .brush-cursor')})})()`);

console.log("setup", await evaluate(`(async () => {
  const z = await import('/src/model/zones.svelte.ts'); const zm = await import('/src/model/zone.ts');
  const b = await import('/src/model/board.svelte.ts'); const c = await import('/src/board/camera.svelte.ts');
  z.addZone({ id: 'z1', name: 'Work', color: '#3d7ab8', parts: [zm.rectContour(-40, -20, 40, 30)], holes: [] });
  b.addNote({ id: 'n1', type: 'note', name: 'Inside', text: 'x', x: -35, y: -15, width: 20, height: null, createdAt: Date.now() });
  c.camera.x = 0; c.camera.y = 0; c.camera.zoom = 1;
  return 'ok';
})()`));
await wait(600);
// 1. select tool: no brush cursor
await mouse("mouseMoved", 700, 500); await wait(150);
console.log("1 select tool (cursor must be false):", await state());
// 2. zone tool, Shift toggles move mode, drag zone without Ctrl (zone at screen ~ x 240..640? world -40..0 → screen 240..640 at zoom 1 with 10px/u, center 640)
const t = await evaluate(`(async()=>{const t=await import('/src/tools/tool.svelte.ts');t.tool.active='zone';return t.tool.active})()`);
await mouse("mouseMoved", 500, 350); await wait(150);
console.log("2a zone tool brush (cursor true):", await state());
await key("ShiftLeft", "Shift");
console.log("2b mode badge:", await evaluate(`document.querySelector('[data-zone-mode-toggle]')?.textContent?.trim() ?? 'none'`));
await drag(500, 300, 500, 200);
console.log("2c after plain move (zone y up 10u, note same):", await state());
await drag(500, 200, 400, 200, 2 /* Ctrl */);
console.log("2d after Ctrl move (zone and note x -10u):", await state());
await key("ShiftLeft", "Shift");
// 3. select tool, RMB zone → Move zone
await evaluate(`(async()=>{const t=await import('/src/tools/tool.svelte.ts');t.tool.active='select';return 1})()`);
await mouse("mouseMoved", 500, 380); await mouse("mousePressed", 500, 380, "right", 2); await mouse("mouseReleased", 500, 380, "right", 0); await wait(250);
const item = await evaluate(`(()=>{const e=document.querySelector('[data-zone-move-menu]');if(!e)return 'no item';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`);
console.log("3a menu item:", item);
if (item !== "no item") {
  const p = JSON.parse(item);
  await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, "left", 1); await mouse("mouseReleased", p.x, p.y, "left", 0); await wait(200);
  for (let i = 1; i <= 8; i += 1) { await mouse("mouseMoved", p.x, p.y + i * 10); await wait(16); }
  await key("Enter", "Enter");
  console.log("3b after RMB Move zone + Enter (zone moved down ~):", await state());
}
await wait(300);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
