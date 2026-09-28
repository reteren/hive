// Alt+Ctrl multi-select from any part; LMB confirms G over a node body; S inside start radius does nothing.
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
const sel = () => ev(`(async()=>{const s=await import('/src/selection/selection.svelte.ts');return s.selection.ids.join(',')||'-'})()`);
const pos = (nid) => ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const n=b.board.notes.${nid};return 'x='+n.x.toFixed(1)+' y='+n.y.toFixed(1)+' scale='+(n.scale??1)})()`);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');const n=Date.now();
 b.addNote({id:'a',type:'note',name:'A',text:'alpha text',x:-50,y:-25,width:25,height:null,createdAt:n});
 b.addNote({id:'ls',type:'list',name:'List',text:'',x:-10,y:-25,width:30,height:null,createdAt:n+1,listItems:[{id:'r1',targetId:null,label:'row one'},{id:'r2',targetId:null,label:'row two'}]});
 b.addNote({id:'c',type:'note',name:'C',text:'gamma',x:30,y:-25,width:25,height:null,createdAt:n+2});
 c.camera.x=0;c.camera.y=0;c.camera.zoom=1;return 1})()`);
await wait(600);
const ALT = 1, CTRL = 2;
await click(await at('[data-note-id="a"] [data-note-body]') ?? await at('[data-note-id="a"]'), ALT | CTRL);
await click(await at('[data-note-id="ls"] [data-list-row="r2"]'), ALT | CTRL);
await click(await at('[data-note-id="c"] [data-note-body]') ?? await at('[data-note-id="c"]'), ALT | CTRL);
console.log("Alt+Ctrl on a, list row, c →", await sel(), "| rows:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.ls.listItems.length})()`));
await click(await at('[data-note-id="c"]'), ALT | CTRL);
console.log("Alt+Ctrl again on c (toggle off) →", await sel());
// G: select a, grab, move over the List row, LMB there
await click(await at('[data-note-id="a"] [data-note-header]'));
const h = await at('[data-note-id="a"] [data-note-header]'); await mouse("mouseMoved", h.x, h.y);
await key("g", "KeyG", 71);
const row = await at('[data-note-id="ls"] [data-list-row="r1"]');
for (let i = 1; i <= 8; i += 1) { await mouse("mouseMoved", h.x + (row.x - h.x) * i / 8, h.y + (row.y - h.y) * i / 8); await wait(30); }
await click(row);
console.log("G + LMB over List row: mode:", await ev(`document.querySelector('[data-transform-mode]')?.getAttribute('data-transform-mode')??'none'`), "a:", await pos("a"), "list rows:", await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');return b.board.notes.ls.listItems.length})()`));
// S: move cursor inward past the start radius
await click(await at('[data-note-id="c"] [data-note-header]'));
const cc = await at('[data-note-id="c"]'); const before = await pos("c");
await mouse("mouseMoved", cc.x + 80, cc.y); await key("s", "KeyS", 83);
for (let i = 1; i <= 8; i += 1) { await mouse("mouseMoved", cc.x + 80 - i * 9, cc.y + i * 2); await wait(30); }
console.log("S pulled inward:", before, "→", await pos("c"));
await key("Escape", "Escape", 27);
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
