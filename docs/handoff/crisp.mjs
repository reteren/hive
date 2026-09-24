// Visual check: two notes + a link at high zoom, screenshot via CDP.
import { writeFileSync } from "node:fs";

const port = 9334;
const out = process.argv[2];
const targets = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

const setup = `(async () => {
  const b = await import('/src/model/board.svelte.ts');
  const l = await import('/src/model/links.svelte.ts');
  const c = await import('/src/board/camera.svelte.ts');
  b.addNote({ id: 'n1', type: 'note', name: 'Note 5', text: 'Crisp text check йй', x: -20, y: -12, width: 30, height: null });
  b.addNote({ id: 'n2', type: 'note', name: 'Note 4', text: 'Second', x: 2, y: 8, width: 30, height: null });
  l.addLink({ id: 'l1', from: 'n1', to: 'n2', kind: 'strong', shape: 'zigzag' });
  l.addLink({ id: 'l2', from: 'n2', to: 'n1', kind: 'weak', shape: 'curved' });
  c.camera.x = -5; c.camera.y = 0; c.camera.zoom = 3;
  return 'ok';
})()`;
const r = await send("Runtime.evaluate", { expression: setup, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text));
await new Promise((res) => setTimeout(res, 800));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
