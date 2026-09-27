// Debug after 1.2.1: per-object trash entries (real keys/mouse) and no resize handles on fixed-size nodes.
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const click = async (p, modifiers = 0) => { await mouse("mouseMoved", p.x, p.y, "none", 0, modifiers); await mouse("mousePressed", p.x, p.y, "left", 1, modifiers); await mouse("mouseReleased", p.x, p.y, "left", 0, modifiers); await wait(200); };
const key = async (k, code, vk, modifiers = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await wait(250); };
const at = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const state = () => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const l=await import('/src/model/links.svelte.ts');const r=await import('/src/model/retention.svelte.ts');
  return JSON.stringify({notes:Object.values(b.board.notes).filter(n=>n.type==='note').map(n=>n.name),links:Object.keys(l.links.byId).length,trash:r.trash.entries.map(e=>e.notes.map(n=>n.name).join('+'))})})()`);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const l=await import('/src/model/links.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 for(const [i,name] of ['A','B','C'].entries()) b.addNote({id:name,type:'note',name,text:name,x:-60+i*35,y:-30,width:25,height:null,createdAt:n+i});
 l.addLink({id:'ab',from:'A',to:'B',kind:'strong',shape:'base'}); l.addLink({id:'bc',from:'B',to:'C',kind:'strong',shape:'base'});
 for(const [i,k] of ['stats','progress','goal','trash','archive'].entries()) b.addNote({id:'k'+i,type:k,name:k,text:'',x:-90+i*45,y:10,width:30,height:null,createdAt:n+10+i});
 c.camera.x=0;c.camera.y=0;c.camera.zoom=0.8;return 1})()`);
await wait(600);
// select A, B, C with Ctrl-click and press Delete
await click(await at('[data-note-id="A"] [data-note-header]'));
await click(await at('[data-note-id="B"] [data-note-header]'), 2);
await click(await at('[data-note-id="C"] [data-note-header]'), 2);
await key("Delete", "Delete", 46);
console.log("after deleting 3 (3 separate entries):", await state());
console.log("trash rows in node:", await ev(`document.querySelectorAll('[data-note-id="k3"] [data-trash-entry]').length`));
// restore the entry of B via the trash node's first matching Restore button
const restoreB = await ev(`(()=>{const rows=[...document.querySelectorAll('[data-note-id="k3"] [data-trash-entry]')];const row=rows.find(r=>/\\bB\\b/.test(r.textContent));const b=row&&[...row.querySelectorAll('button')].find(x=>/^Restore/i.test(x.textContent.trim()));if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
if (restoreB) { await click(restoreB); const conf = await ev(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>/^Confirm/i.test(b.textContent.trim()));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); if (conf) await click(conf); }
console.log("after restoring B alone (no links yet):", await state());
await key("z", "KeyZ", 90, 2);
await key("z", "KeyZ", 90, 2);
console.log("after 2x Undo (all back, trash empty):", await state());
// fixed-size nodes: select each, count resize handles
for (const [i, k] of ["stats", "progress", "goal", "trash", "archive"].entries()) {
  await click(await at(`[data-note-id="k${i}"] [data-note-header]`));
  console.log(k, "handles:", await ev(`document.querySelectorAll('[data-resize-handle]').length`), "size:", await ev(`(()=>{const r=document.querySelector('[data-note-id="k${i}"]').getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)})()`));
}
ws.close();
