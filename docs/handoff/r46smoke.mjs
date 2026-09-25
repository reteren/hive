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
  const b = await import('/src/model/board.svelte.ts');
  const z = await import('/src/model/zones.svelte.ts');
  const sh = await import('/src/zones/shape.ts');
  const zm = await import('/src/model/zone.ts');
  const se = await import('/src/zones/shapeEdit.svelte.ts');
  const c = await import('/src/board/camera.svelte.ts');
  let shape = { parts: [zm.rectContour(-60, -40, 120, 90)], holes: [] };
  shape = sh.subtractRect(shape, { x: -15, y: -10, width: 30, height: 30 });
  shape = sh.subtractRect(shape, { x: 20, y: -40, width: 40, height: 30 });
  z.addZone({ id: 'z1', name: 'Shaped', color: '#3d7ab8', parts: shape.parts, holes: shape.holes });
  z.addZone({ id: 'z2', name: 'Other', color: '#4f9d5d', parts: [zm.rectContour(70, -40, 40, 40)], holes: [] });
  b.addNote({ id: 'n1', type: 'note', name: 'Inside', text: 'x', x: -50, y: 10, width: 30, height: null, createdAt: Date.now() });
  se.enterShapeEdit('z1');
  c.camera.x = 10; c.camera.y = 5; c.camera.zoom = 0.55;
  return JSON.stringify(shape);
})()`;
const r = await send("Runtime.evaluate", { expression: setup, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails));
await new Promise((res) => setTimeout(res, 1000));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
