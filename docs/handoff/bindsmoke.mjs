// Settings: click the quick-input shortcut button, press a new chord, verify it is recorded; Escape cancels.
const page = (await fetch(`http://localhost:9334/json/list`).then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const click = async (p) => { for (const [t, b] of [["mouseMoved", 0], ["mousePressed", 1], ["mouseReleased", 0]]) await send("Input.dispatchMouseEvent", { type: t, x: p.x, y: p.y, button: t === "mouseMoved" ? "none" : "left", buttons: b, clickCount: t === "mouseMoved" ? 0 : 1 }); await wait(300); };
const at = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const MOD = { Alt: [1, 18, "AltLeft"], Control: [2, 17, "ControlLeft"], Shift: [8, 16, "ShiftLeft"] };
const chord = async (mods, key, code, vk) => {
  let m = 0; for (const k of mods) { m |= MOD[k][0]; await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: MOD[k][2], windowsVirtualKeyCode: MOD[k][1], modifiers: m }); }
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers: m });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers: m });
  for (const k of [...mods].reverse()) { m &= ~MOD[k][0]; await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: MOD[k][2], windowsVirtualKeyCode: MOD[k][1], modifiers: m }); }
  await wait(400);
};
const value = () => ev(`(async()=>{const s=await import('/src/settings/quickInputShortcut.svelte.ts');return s.quickInputShortcut.value+' | btn: '+document.querySelector('[data-quick-input-shortcut-setting] button')?.textContent.trim()})()`);
// open settings (gear, top right)
await ev(`(async()=>{const s=await import('/src/settings/settingsPanel.svelte.ts');s.settingsPanel.open=true;return 1})()`); await wait(400);
const btn = await at('[data-quick-input-shortcut-setting] button');
console.log("setting visible:", !!btn, "initial:", await value());
await click(btn); console.log("capturing:", await value());
await chord(["Control", "Shift"], "K", "KeyK", 75);
console.log("after Ctrl+Shift+K:", await value());
await click(await at('[data-quick-input-shortcut-setting] button'));
await chord(["Alt"], "n", "KeyN", 78);
console.log("after Alt+N:", await value());
await click(await at('[data-quick-input-shortcut-setting] button'));
await chord([], "Escape", "Escape", 27);
console.log("after Escape:", await value());
console.log("errors:", errors.length ? errors.join(" || ") : "none");
ws.close();
