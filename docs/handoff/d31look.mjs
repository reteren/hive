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
await mouse("mouseMoved", 700, 450); await key("q", "KeyQ", 81); await wait(500);
await shot("d31-qmenu");
console.log("create items:", await ev(`[...document.querySelectorAll('.create-menu .create-item')].slice(0,4).map(b=>b.textContent.trim()).join(' | ')`));
await key("Escape", "Escape", 27);
const fileBtn = await ev(`(()=>{const b=document.querySelector('[data-menu="file"]')||[...document.querySelectorAll('[data-menubar] button')].find(b=>/file/i.test(b.textContent));if(!b)return null;const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
console.log("file btn", fileBtn);
if (fileBtn) { await click(fileBtn[0], fileBtn[1]); await wait(300); await shot("d31-file"); console.log("file items:", await ev(`[...document.querySelectorAll('[data-menu-item]')].map(b=>b.textContent.trim().replace(/\s+/g,' ')).join(' | ')`));
  await mouse("mouseMoved", fileBtn[0]+45, fileBtn[1]); await wait(300); await shot("d31-edit"); console.log("edit items:", await ev(`[...document.querySelectorAll('[data-menu-item]')].map(b=>b.textContent.trim().replace(/\s+/g,' ')).join(' | ')`)); }
console.log("dock:", await ev(`[...document.querySelectorAll('.panel-dock button')].map(b=>b.textContent.trim()||b.getAttribute('aria-label')).join(' | ')`));
console.log("errors", errors);
process.exit(0);
