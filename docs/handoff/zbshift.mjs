// R3 visual smoke: tasks, dependency, modules, plus/minus.
import { writeFileSync } from "node:fs";

const port = 9334;
const out = process.argv[2];
const page = (await fetch(`http://localhost:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

const setup = `(async () => {
  const t = await import('/src/tools/tool.svelte.ts');
  const c = await import('/src/board/camera.svelte.ts');
  c.camera.x = 0; c.camera.y = 0; c.camera.zoom = 0.3;
  const bs = await import('/src/zones/brushState.svelte.ts'); bs.setBrushSize(20);
  t.tool.active = 'zone';
  return 'ok';
})()`;
const mouse = (type, x, y, button = 'none', buttons = 0, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, modifiers, clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0 });
async function stroke(points, button, modifiers = 0) {
  const bits = button === 'left' ? 1 : 2;
  await mouse('mouseMoved', points[0][0], points[0][1], 'none', 0, modifiers);
  await mouse('mousePressed', points[0][0], points[0][1], button, bits, modifiers);
  for (const [x, y] of points.slice(1)) { await mouse('mouseMoved', x, y, button, bits, modifiers); await new Promise((r) => setTimeout(r, 16)); }
  const last = points.at(-1);
  await mouse('mouseReleased', last[0], last[1], button, 0, modifiers);
  await new Promise((r) => setTimeout(r, 150));
}
const r = await send("Runtime.evaluate", { expression: setup, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails));
await new Promise((res) => setTimeout(res, 800));
const line = (x0, y0, x1, y1, n = 20) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
await stroke(line(303, 253, 703, 253), 'left', 8);   // Shift: off-grid
await stroke(line(303, 453, 703, 453), 'left');      // grid
await mouse('mouseMoved', 800, 600);
await new Promise((res) => setTimeout(res, 500));
const info = await send("Runtime.evaluate", { expression: "(async()=>{const z=await import('/src/model/zones.svelte.ts');return JSON.stringify(z.zones.order.map(id=>({id,first:z.zones.byId[id].parts[0][0]})))})()", awaitPromise: true, returnByValue: true });
console.log(info.result.result.value);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
