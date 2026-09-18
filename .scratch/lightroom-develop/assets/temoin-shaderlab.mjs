// NOTRE COTE DU MEME BANC DE MESURE.
//
// LA QUESTION : notre pipeline change-t-il le grain de la photo AVANT qu'aucun
// debruitage n'existe ? Si oui, toute amplitude de Detail calibree sur la
// campagne Lightroom serait biaisee du meme facteur, et rien ne le dirait — le
// biais vivrait dans le zero de l'instrument, pas dans les mesures.
//
// Elle se pose maintenant precisement parce que la campagne n'a pas encore
// tourne : un zero se controle avant de servir, pas apres.
//
// CE QUE CE SCRIPT REND : trois crops de 1400x1400 pris au CENTRE, a l'echelle
// NATIVE. Le crop n'est pas un raccourci — deux images de tailles sources
// differentes decimees vers un meme cote ne prelevent pas les memes pixels,
// donc leurs grains ne se comparent plus. A l'echelle native, la question ne se
// pose pas. Et un grain se juge en 1:1 de toute facon.
//
//   sl-temoin       : etage au defaut, donc SAUTE — le composite nu.
//   sl-texture-p100 : Texture +100, a comparer au +100 de Lightroom.
//   sl-texture-m60  : Texture -60, a comparer au -60 de Lightroom.
//
// Les PNG partent dans le dossier des mesures, et se lisent avec le MEME
// instrument que les exports de Lightroom : comparer-temoin-shaderlab.py.
//
// Aucun backtick dans ces commentaires : le corps injecte plus bas vit dans des
// template literals, et un backtick de commentaire les ferme (CLAUDE.md).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
const PHOTO = process.argv[2] ?? "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";
const COTE = 1400;
const SORTIE = join(homedir(), "Documents", "shaderlab-lightroom-mesures");

const CAS = [
  ["sl-temoin", {}],
  ["sl-texture-p100", { reglagesDeBase: { texture: 100 } }],
  ["sl-texture-m60", { reglagesDeBase: { texture: -60 } }],
];

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("aucune page CDP sur " + CDP);
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

const FRAME_ID = "__temoinShaderlab";
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
await new Promise((r) => setTimeout(r, 400));
const ctx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));
if (!ctx) throw new Error("iframe du harnais introuvable");

const b64 = readFileSync(PHOTO).toString("base64");
await evalIn(`window.__parts = []; "ok"`, ctx.id);
for (let i = 0; i < b64.length; i += 2_000_000) {
  await evalIn(`window.__parts.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); "ok"`, ctx.id);
}

await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__parts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const gpu = await initGpu(cv);
  const r = new Renderer(gpu, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  window.__tsl = { r, openDocument, source: [bmp.width, bmp.height] };
  return "ok";
})()`, ctx.id);

mkdirSync(SORTIE, { recursive: true });
const source = await evalIn(`JSON.stringify(window.__tsl.source)`, ctx.id);
console.log("photo   : " + PHOTO.split("/").pop() + "   " + JSON.parse(source).join("x"));
console.log("crop    : " + COTE + "x" + COTE + " au centre, echelle native");
console.log("sortie  : " + SORTIE);
console.log("");

for (const [nom, develop] of CAS) {
  const meta = JSON.parse(await evalIn(`(async () => {
    const { r, openDocument } = window.__tsl;
    const develop = ${JSON.stringify(develop)};
    const stack = openDocument(r, "photo").stack;
    r.setDevelop(develop);
    const f = await r.exportFrame(stack.layers, null, develop);
    const C = ${COTE};
    const x0 = Math.max(0, ((f.width - C) >> 1)), y0 = Math.max(0, ((f.height - C) >> 1));
    const w = Math.min(C, f.width), h = Math.min(C, f.height);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    const img = g.createImageData(w, h);
    let somme = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((y0 + y) * f.width + (x0 + x)) * 4, d = (y * w + x) * 4;
        img.data[d] = f.pixels[s]; img.data[d + 1] = f.pixels[s + 1];
        img.data[d + 2] = f.pixels[s + 2]; img.data[d + 3] = 255;
        somme += f.pixels[s];
      }
    }
    g.putImageData(img, 0, 0);
    window.__png = cv.toDataURL("image/png");
    return JSON.stringify({ W: f.width, H: f.height, w, h, moy: somme / (w * h), n: window.__png.length });
  })()`, ctx.id));
  // TEMOIN DE RENDU : une capture noire a l'air d'une reussite jusqu'a ce qu'on
  // l'ouvre (CLAUDE.md, moyen de preuve UI).
  if (meta.moy < 5 || meta.moy > 250) throw new Error(nom + " : aplat, moyenne du rouge " + meta.moy.toFixed(1));

  let data = "";
  for (let i = 0; i < meta.n; i += 2_000_000) {
    data += await evalIn(`window.__png.slice(${i}, ${i + 2_000_000})`, ctx.id);
  }
  const brut = Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
  writeFileSync(join(SORTIE, nom + ".png"), brut);
  console.log(
    nom.padEnd(18) + " rendu " + meta.W + "x" + meta.H +
    "   crop " + meta.w + "x" + meta.h +
    "   moyenne rouge " + meta.moy.toFixed(1) +
    "   " + (brut.length / 1048576).toFixed(1) + " Mo");
}

console.log("");
console.log("Lire avec : python comparer-temoin-shaderlab.py");
ws.close();
