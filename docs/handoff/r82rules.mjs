// R8.2 smoke part 2 (run after r82smoke.mjs): weekday chip + Save, Repeat select -> Monthly, stopwatch session/task modes.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const clickEl = async (expr) => { const p = await ev(`(()=>{const e=${expr};if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); if (!p) return false; await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, "left", 1); await mouse("mouseReleased", p.x, p.y, "left", 0); await wait(350); return true; };
const shot = async (n) => writeFileSync(`C:/Users/reteren/AppData/Local/Temp/claude/${n}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const ids = await ev(`window.__ids`);
const node = (k) => `document.querySelector('[data-note-id="${ids[k]}"]')`;
const rule = (k) => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return JSON.stringify(b.board.notes['${ids[k]}'].time.schedule)})()`);
await ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');cam.camera.x=60;cam.camera.y=25;cam.camera.zoom=0.9})()`); await wait(400);
console.log("Fr chip:", await clickEl(`[...${node("t2")}.querySelectorAll('.weekday-toggle')].find(b=>b.textContent.trim()==='Fr')`));
console.log("save:", await clickEl(`${node("t2")}.querySelector('.time-save')`));
console.log("t2 schedule:", await rule("t2"));
console.log("calendar Fridays:", await ev(`[...document.querySelectorAll('[data-calendar-day]')].filter(x=>new Date(x.dataset.calendarDay+'T12:00').getDay()===5).map(x=>x.dataset.calendarDay.slice(5)+':'+(x.querySelector('.day-count')?.textContent??(x.querySelector('.day-dot')?'1':'0'))).join(' ')`));
// Repeat select on Daily node -> Monthly
await ev(`(async()=>{const cam=await import('/src/board/camera.svelte.ts');cam.camera.x=60;cam.camera.y=-15})()`); await wait(400);
const trig = `${node("t1")}.querySelector('[id$="-at-repeat"]')`;
console.log("repeat trigger:", await ev(`${trig}?.tagName+' '+${trig}?.textContent?.trim()`));
await clickEl(trig);
console.log("options:", await ev(`[...document.querySelectorAll('[role=option]')].map(o=>o.textContent.trim()).join(',')`));
await clickEl(`[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.trim()==='Monthly')`);
await shot("r82-monthly");
await clickEl(`${node("t1")}.querySelector('.time-save')`);
console.log("t1 schedule:", await rule("t1"));
// Undo
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 }); await wait(300);
console.log("t1 after Ctrl+Z:", await rule("t1"));
// Stopwatch modes
await clickEl(`[...${node("t1")}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Stopwatch')`);
await clickEl(`${node("t1")}.querySelector('[id$="stopwatch-mode"],[id*="stopwatch"][aria-haspopup],[data-time-view] [aria-haspopup]')`);
console.log("stopwatch options:", await ev(`[...document.querySelectorAll('[role=option]')].map(o=>o.textContent.trim()).join(',')`));
for (const m of ["Session", "Task created", "Task done"]) {
  const ok = await clickEl(`[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.trim().startsWith('${m}'))`);
  await wait(1200);
  console.log(m, ok, "->", await ev(`${node("t1")}.querySelector('[data-time-view]')?.innerText.replace(/\s+/g,' ').slice(0,160)`));
  await clickEl(`${node("t1")}.querySelector('[data-time-view] [aria-haspopup]')`);
}
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await shot("r82-stopwatch");
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
