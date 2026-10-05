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
// Node glow: RMB → Add glow on a note and a beacon, Color as main, sliders, Esc restores, Undo/Redo.
const rmb = async (sel) => { const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+Math.min(12,b.height/2)]})()`); await mouse("mouseMoved", r[0], r[1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r[0], y: r[1], button: "right", buttons: 2, clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r[0], y: r[1], button: "right", buttons: 0, clickCount: 1 }); await wait(400); };
const menuItems = () => ev(`[...document.querySelectorAll('[role=menu] [role=menuitem], [role=menu] button')].map(b=>b.textContent.trim()).filter(Boolean)`);
const clickItem = async (label) => { const p = await ev(`(()=>{const b=[...document.querySelectorAll('[role=menu] [role=menuitem], [role=menu] button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)}));if(!b)return null;const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`); if (p) await click(p[0], p[1]); return !!p; };
const glow = (id) => ev(`(async()=>JSON.stringify((await import('/src/model/board.svelte.ts')).board.notes['${id}']?.glow ?? null))()`);
const shadow = (id) => ev(`(()=>{const e=document.querySelector('[data-note-id="${id}"]');return e?getComputedStyle(e).boxShadow.slice(0,80):'none'})()`);
await send("Page.reload"); await wait(2500);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1;c.camera.x=0;c.camera.y=0;const n=Date.now();b.addNote({id:'n1',type:'note',name:'Glow me',text:'hello',x:-40,y:-20,width:24,height:null,color:'#d04a8a',createdAt:n});b.addNote({id:'bc',type:'beacon',name:'Hub',text:'',x:25,y:-20,width:7.2,height:7.2,color:'#40a0e0',createdAt:n+1});(await import('/src/history/history.svelte.ts')).clear();return 1})()`);
await wait(600);
await rmb('[data-note-id="n1"]');
console.log("1 note menu:", (await menuItems()).filter((t) => /glow|color/i.test(t)).join(" | "));
await clickItem("Add glow"); await wait(400);
console.log("2 popover:", await ev(`!!document.querySelector('[data-glow-popover]')`), "| glow", await glow("n1"));
const btn = await ev(`(()=>{const b=[...document.querySelectorAll('[data-glow-popover] button')].find(b=>b.textContent.trim()==='Color as main');const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
await click(btn[0], btn[1]); await wait(200);
console.log("3 color as main:", await glow("n1"));
await shot("glow-note");
await key("Escape", "Escape", 27); await wait(300);
console.log("4 Esc: glow", await glow("n1"), "| popover closed", await ev(`!document.querySelector('[data-glow-popover]')`));
// add again and keep (click outside)
await rmb('[data-note-id="n1"]'); await clickItem("Add glow"); await wait(300);
await click(btn[0], btn[1]); await wait(200);
const done = await ev(`(()=>{const b=[...document.querySelectorAll('[data-glow-popover] button')].find(b=>b.textContent.trim()==='Done');const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
await click(done[0], done[1]); await wait(400);
console.log("5 kept: glow", await glow("n1"), "| shadow", await shadow("n1"), "| history", await ev(`(async()=>{const h=await import('/src/history/history.svelte.ts');return h.history.entries.length+':'+h.history.entries.at(-1)?.label})()`));
await key("z", "KeyZ", 90, 2); await wait(300);
console.log("6 undo:", await glow("n1"));
await key("z", "KeyZ", 90, 10); await wait(300);
console.log("6 redo:", await glow("n1"));
// beacon
await rmb('[data-note-id="bc"] .beacon-circle, [data-note-id="bc"]');
console.log("7 beacon menu:", (await menuItems()).filter((t) => /glow/i.test(t)).join(" | "));
if (await clickItem("Add glow")) { await wait(300); await click(btn[0], btn[1]); await wait(100); await click(900, 650); await wait(300); }
console.log("7 beacon glow:", await glow("bc"));
await rmb('[data-note-id="n1"]');
console.log("8 menu with glow:", (await menuItems()).filter((t) => /glow/i.test(t)).join(" | "));
await key("Escape", "Escape", 27);
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=0.4})()`); await wait(300); await shot("glow-zoomout");
await ev(`(async()=>{const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1})()`); await wait(300); await shot("glow-final");
console.log("errors:", errors);
process.exit(0);
