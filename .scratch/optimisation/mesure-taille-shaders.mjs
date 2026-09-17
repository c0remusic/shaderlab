// Taille REELLE des shaders composes, par l'iframe du harnais (modules du disque).
import path from "node:path";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const contexts = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id; pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});
await send("Runtime.enable");
const evalIn = async (expression, contextId) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, contextId });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};

const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res) => {
  document.getElementById("__taille")?.remove();
  const f = document.createElement("iframe");
  f.id = "__taille";
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok");
  document.body.appendChild(f);
})`);
await new Promise((r) => setTimeout(r, 300));
const ctx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));

const res = JSON.parse(await evalIn(`(async () => {
  const { composeShader } = await import("/src/render/shaderCompose.ts");
  const { effectRegistry } = await import("/src/render/effects/registry.ts");
  const { developApplyOrder } = await import("/src/render/developRegistry.ts");
  const { blendRegistry } = await import("/src/render/blend/registry.ts");
  const normal = blendRegistry.find((b) => b.id === "normal").wgsl;
  const lignes = [];
  let total = 0;
  const pousse = (nom, src) => { lignes.push([nom, src.length]); total += src.length; };
  for (const e of effectRegistry) {
    const p = e.passes || [];
    pousse(e.id, composeShader(e.wgsl, { applyMask: true, hasPrevPass: p.length > 0,
      hasAuxPass: p.some((x) => x.expose), blendWgsl: normal,
      hasLibraryTexture: !!e.libraryTexture }));
    p.forEach((passe, i) => pousse(e.id + " p" + i,
      composeShader(passe.wgsl, { applyMask: false, hasPrevPass: i > 0 })));
  }
  for (const m of developApplyOrder) {
    const p = m.passes || [];
    pousse("develop:" + m.id, composeShader(m.wgsl, { applyMask: false, hasPrevPass: p.length > 0,
      hasAuxPass: p.some((x) => x.expose) }));
    p.forEach((passe, i) => pousse("develop:" + m.id + " p" + i,
      composeShader(passe.wgsl, { applyMask: false, hasPrevPass: i > 0 })));
  }
  lignes.sort((a, b) => b[1] - a[1]);
  return JSON.stringify({ total, n: lignes.length, top: lignes.slice(0, 8) });
})()`, ctx.id));

console.log(`${res.n} shaders composes, ${(res.total / 1024).toFixed(1)} Kio au total`);
console.log(`moyenne ${(res.total / res.n / 1024).toFixed(2)} Kio`);
for (const [nom, n] of res.top) console.log(`  ${nom.padEnd(30)} ${(n / 1024).toFixed(1)} Kio`);
ws.close();
