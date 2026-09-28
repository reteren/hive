// G undo, S scale mode, Shift handles, Alt+click select.
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const click = async (p, mods = 0) => { await mouse("mouseMoved", p.x, p.y, "none", 0, mods); await mouse("mousePressed", p.x, p.y, "left", 1, mods); await mouse("mouseReleased", p.x, p.y, "left", 0, mods); await wait(300); };
const at = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const key = async (k, code, vk, mods = 0) => { await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await wait(300); };
const note = (nid) => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const s=await import('/src/selection/selection.svelte.ts');const n=b.board.notes.${nid};return 'x='+n.x.toFixed(1)+' y='+n.y.toFixed(1)+' scale='+(n.scale??1)+' selected='+[...(s.selection.ids??s.selection.noteIds??[])].join('|')})()`);
const handles = () => ev(`[...document.querySelectorAll('[data-resize-handle],[data-shift-scale-handle]')].length`);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 b.addNote({id:'nt',type:'note',name:'Note',text:'grab me',x:-40,y:-20,width:25,height:null,createdAt:n});
 b.addNote({id:'tl',type:'tierlist',name:'Tier',text:'',x:10,y:-20,width:60,height:null,createdAt:n+1,tiers:[{id:'rS',name:'S',color:'#e58b83',cards:[]}]});
 b.addNote({id:'ls',type:'list',name:'List',text:'',x:-40,y:10,width:30,height:null,createdAt:n+2,listItems:[{id:'r1',targetId:null,label:'row one'}]});
 c.camera.x=0;c.camera.y=0;c.camera.zoom=1;return 1})()`);
await wait(600);
const hdr = await at('[data-note-id="nt"] [data-note-header]');
await click(hdr); console.log("start:", await note("nt"));
// G then Ctrl+Z during mode
await key("g", "KeyG", 71); for (let i = 1; i <= 6; i += 1) { await mouse("mouseMoved", hdr.x + i * 20, hdr.y + i * 10); await wait(30); }
console.log("G moving:", await note("nt"), "mode:", await ev(`document.querySelector('[data-transform-mode]')?.getAttribute('data-transform-mode')`));
await key("z", "KeyZ", 90, 2); console.log("Ctrl+Z during G:", await note("nt"), "mode:", await ev(`document.querySelector('[data-transform-mode]')?.getAttribute('data-transform-mode')??'none'`));
// G confirm then Ctrl+Z
await mouse("mouseMoved", hdr.x, hdr.y); await key("g", "KeyG", 71); for (let i = 1; i <= 6; i += 1) { await mouse("mouseMoved", hdr.x + i * 20, hdr.y); await wait(30); }
await click({ x: hdr.x + 120, y: hdr.y }); console.log("G confirmed:", await note("nt"));
await key("z", "KeyZ", 90, 2); console.log("Ctrl+Z after G:", await note("nt"));
// S scale
const c0 = await at('[data-note-id="nt"]');
await mouse("mouseMoved", c0.x + 60, c0.y); await key("s", "KeyS", 83);
for (let i = 1; i <= 8; i += 1) { await mouse("mouseMoved", c0.x + 60 + i * 15, c0.y); await wait(30); }
console.log("S scaling:", await note("nt"), "hint:", await ev(`document.querySelector('[data-transform-mode-hint]')?.textContent.trim()??'none'`));
await click({ x: c0.x + 180, y: c0.y }); console.log("S confirmed (LMB):", await note("nt"));
await key("z", "KeyZ", 90, 2); console.log("Ctrl+Z after S:", await note("nt"));
// Handles with Shift on tierlist
await click(await at('[data-note-id="tl"] [data-note-header]'));
console.log("tierlist handles without Shift:", await handles());
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, modifiers: 8 }); await wait(250);
console.log("tierlist handles with Shift held:", await handles());
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 }); await wait(250);
console.log("after Shift released:", await handles());
// Alt+click on a List row × selects list, keeps row
await click({ x: 5, y: 700 });
await click(await at('[data-note-id="ls"] [data-list-remove="r1"]'), 1);
console.log("Alt+click on row ×:", await note("ls"), "rows:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.ls.listItems.length})()`));
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
