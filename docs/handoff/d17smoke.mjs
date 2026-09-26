// 1.1.7 debug smoke: calculator input, tierlist look, goal->goal, zone Ctrl move, focus guard, menu size at open.
import { writeFileSync } from "node:fs";

const out = process.argv[2];
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0) =>
  send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const click = async (x, y, button = "left") => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y, button, button === "left" ? 1 : 2); await mouse("mouseReleased", x, y, button, 0); await wait(150); };
const typeText = async (text) => { for (const ch of text) await send("Input.insertText", { text: ch }); await wait(50); };
const press = async (key, code, vk) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk }); await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk }); await wait(150); };
const center = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);

console.log("setup", await ev(`(async () => {
  const b = await import('/src/model/board.svelte.ts'); const l = await import('/src/model/links.svelte.ts');
  const c = await import('/src/board/camera.svelte.ts'); const now = Date.now();
  b.addNote({ id: 'calc', type: 'calculator', name: 'Calc', text: '', x: -95, y: -40, width: 40, height: null, createdAt: now });
  b.addNote({ id: 't1', type: 'note', name: 'Task', text: 'x', x: -40, y: -40, width: 20, height: null, createdAt: now + 1, task: { done: true, completedAt: now } });
  b.addNote({ id: 'g1', type: 'goal', name: 'Child', text: '', x: -40, y: -15, width: 30, height: null, createdAt: now + 2 });
  b.addNote({ id: 'g2', type: 'goal', name: 'Parent', text: '', x: -40, y: 10, width: 30, height: null, createdAt: now + 3 });
  l.addLink({ id: 'a', from: 't1', to: 'g1', kind: 'strong', shape: 'base' });
  l.addLink({ id: 'b', from: 'g1', to: 'g2', kind: 'strong', shape: 'base' });
  b.addNote({ id: 'tl', type: 'tierlist', name: 'Tiers', text: '', x: 5, y: -40, width: 60, height: null, createdAt: now + 4 });
  c.camera.x = -15; c.camera.y = -5; c.camera.zoom = 1.1;
  return 'ok';
})()`));
await wait(800);
// calculator: type into Expression and press Enter
const input = await center('[data-kind="calculator"] [aria-label="Expression"]');
console.log("calc input", JSON.stringify(input));
if (input) { await click(input.x, input.y); await typeText("2+3*4"); await press("Enter", "Enter", 13); }
console.log("calc entries", await ev(`(async()=>{const c=await import('/src/calculator/calculators.svelte.ts');return JSON.stringify(c.calculatorData('Calc').entries)})()`));
console.log("calc height px", JSON.stringify(await center('[data-note-id="calc"]')));
console.log("goal rows", await ev(`[...document.querySelectorAll('[data-note-id="g2"] [data-goal-row]')].map(e=>e.textContent.trim()).join(' | ')`));
console.log("goal gold", await ev(`(async()=>{const g=await import('/src/goal/goal.ts');return JSON.stringify([g.goalState?.('g1')?.gold, g.goalState?.('g2')?.gold])})()`));
// focus guard: select calc via header, click a resize handle, press G -> active element must not be a button
const header = await center('[data-note-id="t1"] [data-note-header]');
if (header) await click(header.x, header.y);
const handle = await center('[data-resize-handle]');
console.log("handle", JSON.stringify(handle));
if (handle) { await mouse("mouseMoved", handle.x, handle.y); await mouse("mousePressed", handle.x, handle.y, "left", 1); await mouse("mouseReleased", handle.x, handle.y, "left", 0); await wait(100); await press("Escape", "Escape", 27); }
console.log("active after handle click", await ev(`document.activeElement?.tagName + ' ' + (document.activeElement?.className||'')`));
// menu size at open: zoom 0.4 then 1.1, open Q menu each time
async function qMenuWidth(zoom) {
  await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=${zoom};return 1})()`);
  await wait(200); await mouse("mouseMoved", 900, 600); await press("q", "KeyQ", 81); await wait(200);
  const w = await ev(`(()=>{const e=document.querySelector('[data-create-menu]');return e?Math.round(e.getBoundingClientRect().width):null})()`);
  await press("Escape", "Escape", 27); return w;
}
console.log("Q menu width at zoom 0.4 / 1.1:", await qMenuWidth(0.4), await qMenuWidth(1.1));
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1.1;return 1})()`);
await wait(400);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
