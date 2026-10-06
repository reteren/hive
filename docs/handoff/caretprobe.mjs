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
await ev(`(async()=>{const b=await import('/src/model/board.svelte.ts');const c=await import('/src/board/camera.svelte.ts');c.camera.zoom=1.2;c.camera.x=0;c.camera.y=0;b.addNote({id:'t1',type:'note',name:'Txt',text:'hello world',x:-20,y:10,width:30,height:null,color:null,createdAt:Date.now()});return 1})()`);
await wait(700);
const p = await ev(`(()=>{const r=document.querySelector('[data-note-id="t1"]').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height-14]})()`);
await mouse("mouseMoved", p[0], p[1]); await send("Input.dispatchMouseEvent",{type:"mousePressed",x:p[0],y:p[1],button:"left",buttons:1,clickCount:2}); await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:p[0],y:p[1],button:"left",buttons:0,clickCount:2}); await wait(500);
await key("Home","Home",36); await wait(300);
const probe = await ev(`(()=>{const c=document.querySelector('[data-note-id="t1"] .cm-cursor');const out={};if(!c)return 'no cursor';const cr=c.getBoundingClientRect();out.cursor=[cr.left,cr.width,cr.height].map(v=>+v.toFixed(2));
let e=c.parentElement;const chain=[];while(e&&!e.matches('[data-note-id]')){const cs=getComputedStyle(e);const r=e.getBoundingClientRect();chain.push((e.className||e.tagName).toString().split(' ')[0]+' left='+r.left.toFixed(2)+' ov='+cs.overflow+'/'+cs.overflowX+' clip='+cs.clipPath+' contain='+cs.contain+' pad='+cs.paddingLeft+' margL='+cs.marginLeft);e=e.parentElement;}
out.chain=chain;out.style=getComputedStyle(c).borderLeft+' marginLeft='+getComputedStyle(c).marginLeft+' left='+getComputedStyle(c).left;return JSON.stringify(out,null,1)})()`);
console.log(probe);
const r = JSON.parse(await ev(`JSON.stringify(document.querySelector('[data-note-id="t1"] .cm-line').getBoundingClientRect())`));
const s = await send("Page.captureScreenshot", { format: "png", clip: { x: r.x - 20, y: r.y - 6, width: 120, height: r.height + 12, scale: 6 } });
writeFileSync("C:/Users/reteren/AppData/Local/Temp/claude/caret-home.png", Buffer.from(s.result.data, "base64"));
for (const [label, keyName, code, vk] of [["home","Home","Home",36],["end","End","End",35]]) {
  await key(keyName, code, vk); await wait(150);
  const vis = [];
  for (let i = 0; i < 12; i++) {
    vis.push(await ev(`(()=>{const c=document.querySelector('[data-note-id="t1"] .cm-cursor');if(!c)return 'none';const cs=getComputedStyle(c);const layer=c.parentElement;return getComputedStyle(layer).opacity+'/'+cs.opacity+'/'+cs.visibility+'/'+(c.getBoundingClientRect().left.toFixed(1))})()`));
    await wait(100);
  }
  console.log(label, vis.join(" "));
}
process.exit(0);
