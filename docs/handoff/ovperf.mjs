// Alt overview speed on a big board + beacon keeps its own colour.
import { writeFileSync } from "node:fs";
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');for(const i of [...b.board.order])b.removeNote(i);const n=Date.now();
 for(let i=0;i<300;i++)b.addNote({id:'p'+i,type:'note',name:'Note '+i,text:'some text '+i+' with a few words',x:(i%20)*35-350,y:Math.floor(i/20)*25-180,width:30,height:null,createdAt:n+i});
 b.addNote({id:'bc',type:'beacon',name:'Beacon',text:'',x:-10,y:-60,width:7.2,height:7.2,color:'#e040c0',createdAt:n+999});
 c.camera.x=0;c.camera.y=-40;c.camera.zoom=0.9;return 1})()`);
await wait(1500);
// measure: key-down → first frame with the overview painted
for (let round = 0; round < 3; round += 1) {
  await ev(`window.__t0=performance.now();new MutationObserver((l,o)=>{if(document.querySelector('[data-overview-object]')){window.__t1=performance.now();o.disconnect()}}).observe(document.body,{subtree:true,childList:true});1`);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, modifiers: 1 });
  await wait(600);
  console.log(`round ${round}: overview in`, await ev(`Math.round(window.__t1-window.__t0)+' ms'`), "| boxes:", await ev(`document.querySelectorAll('[data-overview-object]').length`), "| beacon bg:", await ev(`getComputedStyle(document.querySelector('[data-overview-object="bc"]')).backgroundColor`));
  if (round === 0) writeFileSync("C:/Users/reteren/AppData/Local/Temp/claude/ovperf.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18 }); await wait(400);
}
console.log("real notes hidden while on / visible after:", await ev(`getComputedStyle(document.querySelector('.notes-world')).visibility`));
ws.close();
