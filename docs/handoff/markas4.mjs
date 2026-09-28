// Mark as v2 smoke (+ in header, Frame before tags, frame only on host/linked): type + add two tags, pick colour, Frame, collapse, insert into a note, frame on the note.
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
const click = async (p) => { await mouse("mouseMoved", p.x, p.y); await mouse("mousePressed", p.x, p.y, "left", 1); await mouse("mouseReleased", p.x, p.y, "left", 0); await wait(250); };
const at = (sel, i = 0) => ev(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const type = async (text) => { for (const ch of text) await send("Input.insertText", { text: ch }); await wait(80); };
const state = () => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.notes.mk;return JSON.stringify({marks:(n?.customMarks??[]).map(m=>m.text+':'+m.color),frame:n?.customMarkFrame??false})})()`);
const height = () => ev(`Math.round(document.querySelector('[data-note-id="mk"]').getBoundingClientRect().height)`);

await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 b.addNote({id:'mk',type:'markas',name:'Mark as',text:'',x:-40,y:-20,width:30,height:null,createdAt:n});
 b.addNote({id:'tg',type:'note',name:'Target',text:'hello',x:10,y:-20,width:30,height:null,createdAt:n+1});
 c.camera.x=-5;c.camera.y=-5;c.camera.zoom=1.3;return 1})()`);
await wait(600);
await click(await at('[data-note-id="mk"] [data-markas-frame]'));
console.log("frame clickable with no tags:", await state());
console.log("editor visible by default:", await ev(`!!document.querySelector('[data-note-id="mk"] [data-markas-editor]')`), "cancel button:", await ev(`[...document.querySelectorAll('[data-note-id="mk"] button')].some(b=>/cancel/i.test(b.textContent))`));
await click(await at('[data-note-id="mk"] [data-markas-text]'));
await type("urgent");
await click(await at('[data-note-id="mk"] [data-markas-add]'));
console.log("after + :", await state());
await click(await at('[data-note-id="mk"] [data-markas-text]'));
await type("idea");
await click(await at('[data-note-id="mk"] .markas-swatch', 4));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await wait(250);
console.log("after Enter with blue swatch:", await state());
await ev(`(async()=>{const l=await import("/src/model/links.svelte.ts");l.addLink({id:"lk",from:"mk",to:"tg",kind:"strong",shape:"base"});return 1})()`); await wait(300);
console.log("frame attr on Mark as itself:", await ev(`document.querySelector('[data-note-id="mk"]').getAttribute('data-custom-mark-frame')`), "on linked note:", await ev(`document.querySelector('[data-note-id="tg"]').getAttribute('data-custom-mark-frame')`));
await ev(`(async()=>{const l=await import("/src/model/links.svelte.ts");l.removeLink("lk");return 1})()`);
const h1 = await height();
await click(await at('[data-note-id="mk"] [data-markas-collapse]'));
console.log("+ visible when collapsed:", !!(await at('[data-note-id="mk"] [data-markas-add]')));
console.log("height expanded/collapsed:", h1, await height(), "editor hidden:", !(await ev(`!!document.querySelector('[data-note-id="mk"] [data-markas-editor]')`)));
const shot1 = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(process.argv[2].replace(".png", "-a.png"), Buffer.from(shot1.result.data, "base64"));
// insert into Target by dragging the Mark-as header onto it
const from = await at('[data-note-id="mk"] [data-note-header]'); const to = await at('[data-note-id="tg"]');
await mouse("mouseMoved", from.x, from.y); await mouse("mousePressed", from.x, from.y, "left", 1);
for (let i = 1; i <= 12; i += 1) { await mouse("mouseMoved", from.x + (to.x - from.x) * i / 12, from.y + (to.y - from.y) * i / 12, "left", 1); await wait(20); }
await mouse("mouseReleased", to.x, to.y, "left", 0); await wait(400);
console.log("target after insert:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.notes.tg;return JSON.stringify({marks:(n.customMarks??[]).map(m=>m.text),frame:n.customMarkFrame,markasGone:!b.board.notes.mk})})()`),
  "target frame attr:", await ev(`document.querySelector('[data-note-id="tg"]').getAttribute('data-custom-mark-frame')`),
  "host Frame checkbox:", await ev(`!!document.querySelector('[data-note-id="tg"] input[type=checkbox]')`), "chips:", await ev(`[...document.querySelectorAll('[data-note-id="tg"] [data-module-row="markas"] *')].filter(e=>e.children.length===0).map(e=>e.textContent.trim()).filter(Boolean).join(',')`));
console.log("errors:", errors.length ? errors.join(" || ") : "none");
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(process.argv[2], Buffer.from(shot.result.data, "base64"));
ws.close();
