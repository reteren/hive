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
const OUTD = "C:/Users/reteren/AppData/Local/Temp/claude";
for (const dpr of [1.25, 1.5]) {
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: dpr, mobile: false });
  await send("Page.reload"); await wait(3000);
  await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=0.87;c.camera.x=0;c.camera.y=0;const n=Date.now();
  b.addNote({id:'h1',type:'note',name:'With header',text:'Some text',x:-42,y:6,width:36,height:null,color:null,createdAt:n});
  b.addNote({id:'h2',type:'note',name:'Hidden header',text:'Some text',x:6,y:6,width:36,height:null,color:null,createdAt:n+1,headerHidden:true});
  b.addNote({id:'h3',type:'note',name:'Colored hidden',text:'Some text',x:6,y:30,width:36,height:null,color:'#c04a8a',createdAt:n+2,headerHidden:true});
  b.addNote({id:'h4',type:'note',name:'Colored',text:'Some text',x:-42,y:30,width:36,height:null,color:'#c04a8a',createdAt:n+3});
  return 1})()`);
  await wait(800);
  for (const id of ["h1", "h2", "h3", "h4"]) {
    const b = JSON.parse(await ev(`JSON.stringify(document.querySelector('[data-note-id="${id}"]').getBoundingClientRect())`));
    for (const [corner, x, y] of [["tl", b.x - 3, b.y - 3], ["br", b.x + b.width - 17, b.y + b.height - 17]]) {
      const s = await send("Page.captureScreenshot", { format: "png", clip: { x, y, width: 20, height: 20, scale: 12 } });
      writeFileSync(`${OUTD}/corner-${dpr}-${id}-${corner}.png`, Buffer.from(s.result.data, "base64"));
    }
  }
}
process.exit(0);
