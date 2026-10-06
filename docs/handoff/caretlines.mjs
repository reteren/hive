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
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1.25, mobile: false });
await send("Page.reload"); await wait(2500);
const NL = "String.fromCharCode(10)";
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1.2;c.camera.x=0;c.camera.y=0;const n=${NL};b.addNote({id:'t1',type:'note',name:'Txt',text:'# Heading'+n+'- list item'+n+''+n+'plain line'+n+'> quote'+n+'**bold** start',x:-15,y:-20,width:30,height:null,color:null,createdAt:Date.now()});return 1})()`);
await wait(600);
const p = await ev(`(()=>{const r=document.querySelector('[data-note-id="t1"] .note-body').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
await mouse("mouseMoved", p[0], p[1]); await send("Input.dispatchMouseEvent",{type:"mousePressed",x:p[0],y:p[1],button:"left",buttons:1,clickCount:2}); await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:p[0],y:p[1],button:"left",buttons:0,clickCount:2}); await wait(500);
await key("Home","Home",36,2); await wait(200);
for (let line = 0; line < 6; line++) {
  if (line > 0) { await key("ArrowDown","ArrowDown",40); }
  await key("Home","Home",36); await wait(120);
  for (let i = 0; i < 20; i++) { const o = await ev(`getComputedStyle(document.querySelector('[data-note-id="t1"] .cm-cursorLayer')).opacity`); if (o === "1") break; await wait(40); }
  const info = await ev(`(()=>{const v=document.querySelector('[data-note-id="t1"] .cm-content');const c=document.querySelector('[data-note-id="t1"] .cm-cursor');const cr=c?c.getBoundingClientRect():null;const ln=document.querySelectorAll('[data-note-id="t1"] .cm-line')[${line}];const lr=ln.getBoundingClientRect();return JSON.stringify({line:ln.textContent, cursor: cr?[+cr.left.toFixed(1),+cr.top.toFixed(1),+cr.height.toFixed(1)]:null, lineBox:[+lr.left.toFixed(1),+lr.top.toFixed(1),+lr.height.toFixed(1)]})})()`);
  const j = JSON.parse(info);
  const s = await send("Page.captureScreenshot", { format: "png", clip: { x: j.lineBox[0] - 10, y: j.lineBox[1] - 2, width: 90, height: j.lineBox[2] + 4, scale: 5 } });
  writeFileSync(`C:/Users/reteren/AppData/Local/Temp/claude/caretline-${line}.png`, Buffer.from(s.result.data, "base64"));
  console.log(line, info);
}
process.exit(0);
