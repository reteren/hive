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
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1.2;c.camera.x=0;c.camera.y=0;b.addNote({id:'t1',type:'note',name:'Sel',text:'select this text by dragging far outside of the node',x:-40,y:-10,width:30,height:null,color:null,createdAt:Date.now()});return 1})()`);
await wait(600);
const editingId = () => ev(`(async()=>(await import('/src/notes/editing.svelte.ts').catch(()=>null))?.editing?.noteId ?? document.querySelector('[data-note-id="t1"] .cm-content[contenteditable=true]') ? 'editing' : 'none')()`);
const p = await ev(`(()=>{const r=document.querySelector('[data-note-id="t1"] .note-body').getBoundingClientRect();return [r.x+12,r.y+10]})()`);
await mouse("mouseMoved", p[0], p[1]); await send("Input.dispatchMouseEvent",{type:"mousePressed",x:p[0],y:p[1],button:"left",buttons:1,clickCount:2}); await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:p[0],y:p[1],button:"left",buttons:0,clickCount:2}); await wait(500);
const isEditing = () => ev(`!!document.querySelector('[data-note-id="t1"] .cm-content[contenteditable=true]')`);
console.log("editing after dblclick:", await isEditing());
// press inside the text, drag far outside the node, release on empty board
const s = await ev(`(()=>{const r=document.querySelector('[data-note-id="t1"] .cm-line').getBoundingClientRect();return [r.x+5,r.y+r.height/2]})()`);
await send("Input.dispatchMouseEvent",{type:"mousePressed",x:s[0],y:s[1],button:"left",buttons:1,clickCount:1});
for (let i=1;i<=15;i++) { await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:s[0]+i*45,y:s[1]+i*20,button:"left",buttons:1}); await wait(25); }
await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:s[0]+15*45,y:s[1]+15*20,button:"left",buttons:0,clickCount:1}); await wait(400);
console.log("after drag-select released outside: editing =", await isEditing(), "| selection length =", await ev(`window.getSelection().toString().length`));
// a normal click on empty board must still end editing
await click(1200, 750); await wait(300);
console.log("after a plain click on the empty board: editing =", await isEditing());
process.exit(0);
