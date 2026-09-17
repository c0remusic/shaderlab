// Passe une MIRE DE PORTEE dans notre pipeline et rend son profil vertical,
// dans la meme forme que `analyse-mire-portee.py` rend celui de Lightroom.
//
// C'est l'instrument qui manquait pour juger Clarte : la mire de presence ne
// peut rien dire de son grand rayon (ses bandes font 48 px), et ses aplats sont
// colles les uns aux autres. La mire de portee separe une marche de TON d'une
// marche de DETAIL, sur des plateaux de 4096 px.
//
// Usage : node mesure-portee-shaderlab.mjs [--cdp 9222]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ICI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const portArg = process.argv.indexOf("--cdp");
const CDP = `http://localhost:${portArg > 0 ? process.argv[portArg + 1] : "9222"}`;

const MIRE = path.join(ICI, "mire", "shaderlab-mire-portee-2048x16384.jpg");
const GEO = JSON.parse(readFileSync(MIRE.replace(/\.jpg$/, ".json"), "utf-8"));
const COLS = [
  { nom: "por-temoin", params: {} },
  { nom: "por-clarte-p100", params: { clarity: 100 } },
  { nom: "por-texture-p100", params: { texture: 100 } },
];

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

const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res) => {
  document.getElementById("__portee")?.remove();
  const f = document.createElement("iframe");
  f.id = "__portee";
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok");
  document.body.appendChild(f);
})`);
await new Promise((r) => setTimeout(r, 300));
const ctx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));
if (!ctx) throw new Error("contexte iframe introuvable");

const b64 = readFileSync(MIRE).toString("base64");
await evalIn(`window.__porParts = []; "ok"`, ctx.id);
for (let i = 0; i < b64.length; i += 2_000_000) {
  await evalIn(`window.__porParts.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); "ok"`, ctx.id);
}
const setup = JSON.parse(await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__porParts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const gctx = await initGpu(cv);
  const r = new Renderer(gctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  window.__por = { openDocument, r };
  return JSON.stringify({ W: bmp.width, H: bmp.height });
})()`, ctx.id));
if (setup.W !== GEO.largeur || setup.H !== GEO.hauteur) {
  throw new Error(`mire ${setup.W}x${setup.H}, geometrie ${GEO.largeur}x${GEO.hauteur}`);
}

const tout = {};
for (const col of COLS) {
  // Le profil se calcule DANS la page : rapatrier 32 Mo de frame pour n'en garder
  // que 16384 nombres serait le seul poste couteux de la mesure.
  const profil = JSON.parse(await evalIn(`(async () => {
    const { openDocument, r } = window.__por;
    const params = ${JSON.stringify(col.params)};
    const develop = Object.keys(params).length ? { reglagesDeBase: params } : {};
    const stack = openDocument(r, "mire").stack;
    r.setDevelop(develop);
    const frame = await r.exportFrame(stack.layers, null, develop);
    const px = frame.pixels, W = frame.width, H = frame.height;
    const x0 = ${GEO.x0}, x1 = ${GEO.x1}, n = x1 - x0;
    const out = new Array(H);
    for (let y = 0; y < H; y++) {
      let s = 0;
      let o = (y * W + x0) * 4;
      for (let x = x0; x < x1; x++, o += 4) s += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
      out[y] = +(s / n).toFixed(3);
    }
    return JSON.stringify(out);
  })()`, ctx.id));
  tout[col.nom] = profil;
  console.log(`${col.nom.padEnd(18)} ${profil.length} lignes`);
}
writeFileSync(path.join(ICI, "portee-shaderlab.json"), JSON.stringify(tout));
console.log("ecrit portee-shaderlab.json");
ws.close();
