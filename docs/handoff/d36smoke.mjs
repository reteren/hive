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
const rmb = async (sel) => { const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+Math.min(12,b.height/2)]})()`); await mouse("mouseMoved", r[0], r[1]); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r[0], y: r[1], button: "right", buttons: 2, clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r[0], y: r[1], button: "right", buttons: 0, clickCount: 1 }); await wait(400); };
const menuItems = () => ev(`[...document.querySelectorAll('[role=menu] [role=menuitem], [role=menu] button')].map(b=>b.textContent.trim()).filter(Boolean)`);
const clickItem = async (label) => { const p = await ev(`(()=>{const b=[...document.querySelectorAll('[role=menu] [role=menuitem], [role=menu] button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)}));if(!b)return null;const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`); if (p) await click(p[0], p[1]); return !!p; };
const typeText = async (t) => { for (const ch of t) await send("Input.dispatchKeyEvent", { type: "char", text: ch }); await wait(150); };
await send("Page.reload"); await wait(3000);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1.4;c.camera.x=0;c.camera.y=0;const n=Date.now();
b.addNote({id:'t1',type:'note',name:'Txt',text:'hello',x:-60,y:10,width:30,height:null,color:null,createdAt:n});
b.addNote({id:'bc',type:'beacon',name:'Hub',text:'',x:30,y:-20,width:7.2,height:7.2,color:'#40a0e0',createdAt:n+1});
(await import('/src/history/history.svelte.ts')).clear();return 1})()`);
await wait(700);
console.log("4 beacon glow:", await ev(`(()=>{const e=document.querySelector('[data-note-id="bc"] [data-note-glow], [data-note-id="bc"][data-note-glow]');const t=document.querySelector('[data-note-id="bc"]');return (e?e.dataset.noteGlow:'none')+' | '+getComputedStyle(e??t).boxShadow.slice(0,90)})()`));
await rmb('[data-note-id="bc"]'); console.log("4 beacon menu:", (await menuItems()).filter((t)=>/glow|smooth/i.test(t)).join(" | ") || "(no glow/smooth items)"); await key("Escape","Escape",27);
// 5/12 typing in note
const p = await ev(`(()=>{const r=document.querySelector('[data-note-id="t1"] .note-body, [data-note-id="t1"]').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height-12]})()`);
await mouse("mouseMoved", p[0], p[1]); await send("Input.dispatchMouseEvent",{type:"mousePressed",x:p[0],y:p[1],button:"left",buttons:1,clickCount:2}); await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:p[0],y:p[1],button:"left",buttons:0,clickCount:2}); await wait(500);
console.log("edit open:", await ev(`!!document.querySelector('[data-note-id="t1"] .cm-content[contenteditable=true]')`));
const w0 = await ev(`(async()=>(await import('/src/model/board.svelte.ts')).board.notes.t1.width)()`);
await key("End","End",35, 2); await typeText(" and a much longer line of text that should make the note wider while typing it");
await wait(500);
console.log("5 width:", w0, "->", await ev(`(async()=>(await import('/src/model/board.svelte.ts')).board.notes.t1.width)()`));
console.log("12 caret:", await ev(`(()=>{const c=document.querySelector('.cm-cursor');return c?getComputedStyle(c).borderLeftColor+' visible='+(getComputedStyle(c.parentElement).display!=='none'):'no caret'})()`));
// 9 RMB on selection
await key("a","KeyA",65,2); await wait(200);
await send("Input.dispatchMouseEvent",{type:"mousePressed",x:p[0],y:p[1]-10,button:"right",buttons:2,clickCount:1}); await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:p[0],y:p[1]-10,button:"right",buttons:0,clickCount:1}); await wait(400);
await shot("d36-editmenu");
console.log("9 editor menu:", await ev(`[...document.querySelectorAll('[data-spellcheck-menu] button, [data-spellcheck-menu] [role=menuitem]')].map(b=>b.textContent.trim()).filter(Boolean).join(' | ')`));
const bold = await ev(`(()=>{const b=[...document.querySelectorAll('[data-spellcheck-menu] button, [data-spellcheck-menu] [role=menuitem]')].find(b=>/^Bold/.test(b.textContent.trim()));if(!b)return null;const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
if (bold) { await click(bold[0], bold[1]); await wait(300); }
console.log("9 text after Bold:", await ev(`document.querySelector('[data-note-id="t1"] .cm-content').textContent.slice(0,40)`));
await key("Escape","Escape",27); await click(700,700); await wait(300);
// 14 colour commit on outside click
await rmb('[data-note-id="t1"]'); await clickItem("Change color"); await wait(400);
console.log("3 eyedropper button:", await ev(`!!document.querySelector('[data-hex-eyedropper]')`));
const hex = await ev(`(()=>{const i=document.querySelector('[data-hex-picker] input[type=text]');const r=i.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
await click(hex[0],hex[1]); await key("a","KeyA",65,2); await typeText("ff0000"); await wait(300);
await click(1300, 750); await wait(400);
console.log("14 color after outside click:", await ev(`(async()=>(await import('/src/model/board.svelte.ts')).board.notes.t1.color)()`));
// 15 ME delete
const me = await ev(`(()=>{const e=document.querySelector('[data-me-delete], .me, [data-me]');if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
console.log("15 me el:", me);
await ev(`(async()=>{const m=await import('/src/beacons/meActions.svelte.ts');return Object.keys(m)})()`).then((k)=>console.log("meActions exports:",k));
await shot("d36-final");
console.log("errors", errors); process.exit(0);
