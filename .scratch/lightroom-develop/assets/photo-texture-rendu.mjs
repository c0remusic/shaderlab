// Rend NOTRE Texture sur une vraie photo, aux memes doses que la campagne
// Lightroom (`ph-*`), et ecrit des detourages 1:1.
//
// POURQUOI 1:1. Texture est un operateur PAR PIXEL : reduit, son effet est
// moyenne et deux variantes tres differentes paraissent identiques (CLAUDE.md,
// lecon de la planche du verre). Une vignette ne repond a rien ici.
//
// ⚠️ PHOTO D'ORIGINE BOITIER UNIQUEMENT — un export deja developpe ferait juger
// nos operateurs par-dessus un developpement etranger.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ICI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SORTIE = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad";
const ORIGIN = "http://localhost:1421";
const portArg = process.argv.indexOf("--cdp");
const CDP = `http://localhost:${portArg > 0 ? process.argv[portArg + 1] : "9222"}`;

const PHOTO = "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";
const CROPS = [
  { nom: "petale", x: 2600, y: 2500 },
  { nom: "feuillage", x: 1200, y: 1200 },
  { nom: "ciel", x: 4200, y: 600 },
];
const TAILLE = 320;
const DOSES = [
  { nom: "ph-temoin", params: {} },
  { nom: "ph-texture-p40", params: { texture: 40 } },
  { nom: "ph-texture-p100", params: { texture: 100 } },
  { nom: "ph-texture-m60", params: { texture: -60 } },
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

const FRAME_ID = "__photoTexture";
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

const b64 = readFileSync(PHOTO).toString("base64");
await evalIn(`window.__phParts = []; "ok"`, frameCtx.id);
for (let i = 0; i < b64.length; i += 2_000_000) {
  await evalIn(`window.__phParts.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); "ok"`, frameCtx.id);
}
const setup = JSON.parse(await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__phParts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = await initGpu(cv);
  const r = new Renderer(ctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  window.__ph = { openDocument, r };
  return JSON.stringify({ W: bmp.width, H: bmp.height });
})()`, frameCtx.id));
console.log(`photo ${setup.W} x ${setup.H}`);

for (const dose of DOSES) {
  const res = JSON.parse(await evalIn(`(async () => {
    const { openDocument, r } = window.__ph;
    const params = ${JSON.stringify(dose.params)};
    const develop = Object.keys(params).length ? { reglagesDeBase: params } : {};
    const stack = openDocument(r, "photo").stack;
    r.setDevelop(develop);
    const frame = await r.exportFrame(stack.layers, null, develop);
    const full = document.createElement("canvas");
    full.width = frame.width; full.height = frame.height;
    full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
    const out = {};
    for (const c of ${JSON.stringify(CROPS)}) {
      const cc = document.createElement("canvas"); cc.width = ${TAILLE}; cc.height = ${TAILLE};
      cc.getContext("2d").drawImage(full, c.x, c.y, ${TAILLE}, ${TAILLE}, 0, 0, ${TAILLE}, ${TAILLE});
      out[c.nom] = cc.toDataURL("image/png");
    }
    return JSON.stringify({ crops: out, fw: frame.width, fh: frame.height });
  })()`, frameCtx.id));
  if (res.fw !== setup.W || res.fh !== setup.H) throw new Error("dimensions de frame inattendues");
  for (const [nom, url] of Object.entries(res.crops)) {
    writeFileSync(path.join(SORTIE, `nous-${dose.nom}-${nom}.png`), Buffer.from(url.split(",")[1], "base64"));
  }
  console.log(`  ${dose.nom} : ${Object.keys(res.crops).length} detourages`);
}
ws.close();
