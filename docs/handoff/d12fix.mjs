// Alt overview survives a stale key-down (Space whose key-up was swallowed) and a pointer released outside; zone resize ignores modifiers.
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const kd = (key, code, vk, mods = 0) => send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers: mods });
const ku = (key, code, vk, mods = 0) => send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers: mods });
const mouse = (type, x, y, button = "none", buttons = 0, modifiers = 0) => send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
const ov = () => ev(`!!document.querySelector('[data-alt-overview]')`);
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const z=await import('/src/model/zones.svelte.ts');const g=await import('/src/model/zone.ts');const c=await import('/src/board/camera.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);for(const i of [...z.zones.order])z.removeZone(i);
 b.addNote({id:'o1',type:'note',name:'Note 5',text:'t',x:-30,y:-15,width:25,height:null,createdAt:Date.now()});z.addZone({id:'z1',name:'Zone A',color:'#6a9fd4',parts:[g.rectContour(-40,20,60,30)],holes:[],createdAt:Date.now()});c.camera.x=0;c.camera.y=10;c.camera.zoom=1;return 1})()`);
await wait(400);
// stale Space: down without up
await kd(" ", "Space", 32); await wait(100);
// stale pointer: press inside, "release outside" = no release event, then a plain move
await mouse("mouseMoved", 700, 600); await mouse("mousePressed", 700, 600, "left", 1); await wait(80);
await mouse("mouseMoved", 710, 610, "none", 0); await wait(150);
await kd("Alt", "AltLeft", 18, 1); await wait(400);
console.log("overview with stale Space + stale pointer:", await ov());
await ku("Alt", "AltLeft", 18); await wait(200);
console.log("overview after Alt up:", await ov());
await ku(" ", "Space", 32);
// zone resize ignores modifiers
await ev(`(async()=>{const m=await import('/src/zones/zoneMode.svelte.ts');m.enterZoneResizeMode('z1');return 1})()`); await wait(200);
for (const [k, c, vk, mod] of [["Shift", "ShiftLeft", 16, 8], ["Control", "ControlLeft", 17, 2], ["Alt", "AltLeft", 18, 1]]) { await kd(k, c, vk, mod); await ku(k, c, vk); await wait(120); }
console.log("resize mode after Shift/Ctrl/Alt:", await ev(`(async()=>{const m=await import('/src/zones/zoneMode.svelte.ts');return m.zoneMode.resizeZoneId})()`));
await kd("a", "KeyA", 65); await ku("a", "KeyA", 65); await wait(150);
console.log("resize mode after 'A' key:", await ev(`(async()=>{const m=await import('/src/zones/zoneMode.svelte.ts');return m.zoneMode.resizeZoneId})()`));
ws.close();
