// Coût des opérateurs de présence, mesuré sur la mire (2048 x 7584, 15,5 Mpx),
// dans le pipeline RÉEL par l'iframe du harnais.
//
// POURQUOI CE SCRIPT EXISTE. Le dépôt impose de mesurer tout changement qui
// ajoute des lectures de texture par pixel (CLAUDE.md), et `perf-probe` n'est
// pas lançable depuis une session d'agent (le bac à sable refuse
// `src-tauri/target/`). Ce qu'on peut mesurer d'ici est le temps de bout en bout
// d'un `exportFrame`, relecture comprise — donc un chiffre trop grand dans
// l'absolu, mais dont la DIFFÉRENCE entre deux réglages est le coût cherché, la
// relecture étant identique dans les deux cas.
//
// ⚠️ Ce n'est PAS une mesure de cadence : elle se prend en build de PRODUCTION,
// et le plancher du build de dev vaut 2,6 fois celui de la prod. Un coût mesuré
// ici EXISTE ; un coût négligeable ici ne prouve rien.
//
// Usage : node cout-presence.mjs [--cdp 9222]
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";

const ICI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const portArg = process.argv.indexOf("--cdp");
const CDP = `http://localhost:${portArg > 0 ? process.argv[portArg + 1] : "9222"}`;

const MIRES = readdirSync(path.join(ICI, "mire"))
  .filter((f) => /^shaderlab-mire-presence-2048x\d+\.jpg$/.test(f)).sort();
const MIRE = path.join(ICI, "mire", MIRES[MIRES.length - 1]);

const CAS = [
  { nom: "temoin (module sauté)", params: {} },
  { nom: "texture 100", params: { texture: 100 } },
  { nom: "clarte 100", params: { clarity: 100 } },
  { nom: "texture + clarte 100", params: { texture: 100, clarity: 100 } },
  { nom: "exposition 1 (sans pyramide)", params: { exposure: 1 } },
];
const REPETITIONS = 7;

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
const evalIn = async (expression, contextId) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, contextId });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const FRAME_ID = "__coutPresence";
const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res) => {
  document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
  const f = document.createElement("iframe");
  f.id = ${JSON.stringify(FRAME_ID)};
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok");
  document.body.appendChild(f);
})`);
await new Promise((r) => setTimeout(r, 300));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));
if (!frameCtx) throw new Error("contexte iframe introuvable");

const b64 = readFileSync(MIRE).toString("base64");
await evalIn(`window.__coutParts = []; "ok"`, frameCtx.id);
for (let i = 0; i < b64.length; i += 2_000_000) {
  await evalIn(`window.__coutParts.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); "ok"`, frameCtx.id);
}
await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__coutParts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = await initGpu(cv);
  const r = new Renderer(ctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  window.__cout = { openDocument, r, W: bmp.width, H: bmp.height };
  return "ok";
})()`, frameCtx.id);

console.log(`mire ${path.basename(MIRE)}, ${REPETITIONS} rendus par cas, mediane`);
for (const cas of CAS) {
  const t = await evalIn(`(async () => {
    const { openDocument, r } = window.__cout;
    const params = ${JSON.stringify(cas.params)};
    const develop = Object.keys(params).length ? { reglagesDeBase: params } : {};
    const stack = openDocument(r, "mire").stack;
    r.setDevelop(develop);
    const ms = [];
    for (let i = 0; i < ${REPETITIONS + 1}; i++) {
      const t0 = performance.now();
      await r.exportFrame(stack.layers, null, develop);
      // Le premier passage compile le shader et alloue : il ne compte pas.
      if (i > 0) ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    return ms[Math.floor(ms.length / 2)];
  })()`, frameCtx.id);
  console.log(`  ${cas.nom.padEnd(30)} ${t.toFixed(1)} ms`);
}
ws.close();
