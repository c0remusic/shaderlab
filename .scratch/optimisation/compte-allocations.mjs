// Compte les objets GPU crees PAR FRAME, par l'iframe du harnais.
//
// POURQUOI. La source d'optimisation proposee (webgpufundamentals) porte
// entierement sur le cout CPU des appels de dessin, pour des milliers d'objets,
// et elle rend en 1x1 px pour isoler l'API — l'inverse de notre charge. Mais une
// de ses techniques transfere peut-etre : elle dit de remplacer un buffer par
// objet et par frame par UN gros buffer a decalages. Or `runEffectPass` appelle
// `createBuffer` pour ses parametres a CHAQUE passe et a CHAQUE frame.
//
// Ce script ne suppose rien : il enveloppe les methodes du device et compte.
//
// Usage : node compte-allocations.mjs [--cdp 9222]
import { readFileSync } from "node:fs";
import path from "node:path";

const ORIGIN = "http://localhost:1421";
const portArg = process.argv.indexOf("--cdp");
const CDP = `http://localhost:${portArg > 0 ? process.argv[portArg + 1] : "9222"}`;
const MIRE = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..", "lightroom-develop", "assets", "mire", "shaderlab-mire-presence-2048x7584.jpg");

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("pas de cible CDP sur " + CDP);
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
const evalIn = async (expr, ctx) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, contextId: ctx });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};

const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res) => {
  document.getElementById("__alloc")?.remove();
  const f = document.createElement("iframe");
  f.id = "__alloc";
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok");
  document.body.appendChild(f);
})`);
await new Promise((r) => setTimeout(r, 300));
const ctx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));

const b64 = readFileSync(MIRE).toString("base64");
await evalIn(`window.__aParts = []; "ok"`, ctx.id);
for (let i = 0; i < b64.length; i += 2_000_000) {
  await evalIn(`window.__aParts.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); "ok"`, ctx.id);
}
await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__aParts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const gctx = await initGpu(cv);
  const r = new Renderer(gctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  // ENVELOPPE : on compte sur le device REEL, apres que tout soit en place.
  const d = gctx.device;
  window.__c = { buffer: 0, bindGroup: 0, texture: 0, pipeline: 0, write: 0 };
  for (const [m, k] of [["createBuffer","buffer"],["createBindGroup","bindGroup"],
                        ["createTexture","texture"],["createRenderPipeline","pipeline"]]) {
    const orig = d[m].bind(d);
    d[m] = (...a) => { window.__c[k]++; return orig(...a); };
  }
  const ow = d.queue.writeBuffer.bind(d.queue);
  d.queue.writeBuffer = (...a) => { window.__c.write++; return ow(...a); };
  window.__alloc = { openDocument, r };
  return "ok";
})()`, ctx.id);

const CAS = [
  { nom: "temoin (etage saute)", params: {} },
  { nom: "exposition 1", params: { exposure: 1 } },
  { nom: "clarte 100 (pyramide)", params: { clarity: 100 } },
  { nom: "tout le bloc presence", params: { texture: 60, clarity: 60, dehaze: 40 } },
];
console.log("objets GPU crees PAR FRAME, mire 2048 x 7584");
const ligne = (a, b, c, d, e, f) =>
  console.log("  " + String(a).padEnd(24) + [b, c, d, e, f].map((v) => String(v).padStart(11)).join(""));
ligne("cas", "buffers", "bindGroups", "textures", "pipelines", "writes");
for (const cas of CAS) {
  const c = JSON.parse(await evalIn(`(async () => {
    const { openDocument, r } = window.__alloc;
    const params = ${JSON.stringify(cas.params)};
    const develop = Object.keys(params).length ? { reglagesDeBase: params } : {};
    const stack = openDocument(r, "mire").stack;
    r.setDevelop(develop);
    await r.exportFrame(stack.layers, null, develop);   // chauffe : compile, alloue
    for (const k of Object.keys(window.__c)) window.__c[k] = 0;
    await r.exportFrame(stack.layers, null, develop);   // celle qu'on compte
    return JSON.stringify(window.__c);
  })()`, ctx.id));
  ligne(cas.nom, c.buffer, c.bindGroup, c.texture, c.pipeline, c.write);
}
ws.close();
