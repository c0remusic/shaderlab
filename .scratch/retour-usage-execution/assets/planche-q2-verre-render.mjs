// Planche Q2 — verre : instruire PAR L'IMAGE deux griefs d'Antoine.
//   (a) "distortion de la couleur un peu moche" -> la DISPERSION (frange coloree
//       de bord). Compare dispersion au defaut (0.25) vs dispersion 0.
//   (b) "on dirait une texture posee, je preferais avant" -> le MATCAP du commit
//       30dfd5b. Le "avant" se rend en swappant glass.ts sur 30dfd5b^ (fait par
//       le SHELL autour de ce script), tag "avant". Le matcap N'A AUCUN CURSEUR
//       (verifie : 30dfd5b n'ajoute aucun name:), donc l'image est la seule voie.
//
// UNE INVOCATION = UN TAG = UN IFRAME FRAIS -> modules relus depuis le DISQUE
// (render-check-page.html, module map vierge). Le shell swappe glass.ts entre les
// deux invocations et laisse le watcher Vite invalider avant de relancer.
//
// Scene : vram-test/photo-1.jpg (photo reelle, contenu varie, vraie couleur a
// juger — PAS la mire achromatique mireVerre). Matieres Poli (6) et Depoli (7).
// Crop 1:1 centre sur le bord le plus contraste de la photo (dispersion =
// phenomene de bord, par pixel) ; vignette reduite pour le voile matcap (masses).
//
// Usage : node planche-q2-verre-render.mjs <current|avant>
// Aucun accent ni backtick dans le code injecte dans la page.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const TAG = process.argv[2];
if (TAG !== "current" && TAG !== "avant") throw new Error("usage: node planche-q2-verre-render.mjs <current|avant>");
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const PHOTO = "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg";
const photoB64 = readFileSync(PHOTO).toString("base64");

// ── connexion CDP ────────────────────────────────────────────────────────
const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("pas de cible CDP");
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
  const r = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
    ...(contextId === undefined ? {} : { contextId }),
  });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const FRAME_ID = "__plancheQ2Frame_" + TAG;
const before = new Set(contexts.map((c) => c.uniqueId));
const loaded = await evalIn(`new Promise((res) => {
  document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
  const f = document.createElement("iframe");
  f.id = ${JSON.stringify(FRAME_ID)};
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok");
  f.onerror = () => res("erreur de chargement");
  document.body.appendChild(f);
})`);
if (loaded !== "ok") throw new Error(`iframe: ${loaded}`);
await new Promise((r) => setTimeout(r, 400));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
if (!frameCtx) throw new Error("contexte iframe introuvable");

await evalIn(`window.__photoParts = []; "ok"`, frameCtx.id);
const CHUNK = 2_000_000;
for (let i = 0; i < photoB64.length; i += CHUNK) {
  await evalIn(`window.__photoParts.push(${JSON.stringify(photoB64.slice(i, i + CHUNK))}); "ok"`, frameCtx.id);
}

// MATIERES : Poli=6, Depoli=7 (lus dans glass.ts). dispersion defaut 0.25.
const MATIERES = [
  { id: "poli", material: 6 },
  { id: "depoli", material: 7 },
];
const DISP = [
  { id: "d25", dispersion: 0.25 },
  { id: "d0", dispersion: 0 },
];

const script = `(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");

  const b64 = window.__photoParts.join("");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const LW = 640;
  const LH = Math.round((LW * bmp.height) / bmp.width);
  const cvp = document.createElement("canvas");
  cvp.width = LW; cvp.height = LH;
  cvp.getContext("2d").drawImage(bmp, 0, 0, LW, LH);
  const photo = await createImageBitmap(cvp);

  // CROP CENTRE = bord le plus contraste de la PHOTO (deterministe, meme point
  // pour toutes les variantes et les deux tags). Gradient de luminance sur la
  // photo source, marge pour tenir un crop 128.
  const S = 128;
  const pctx = cvp.getContext("2d");
  const pd = pctx.getImageData(0, 0, LW, LH).data;
  const lum = (x, y) => { const i = (y * LW + x) * 4; return 0.299 * pd[i] + 0.587 * pd[i + 1] + 0.114 * pd[i + 2]; };
  let bx = LW >> 1, by = LH >> 1, bg = -1;
  const M = S; // marge
  for (let y = M; y < LH - M; y += 3) for (let x = M; x < LW - M; x += 3) {
    const gx = lum(x + 3, y) - lum(x - 3, y);
    const gy = lum(x, y + 3) - lum(x, y - 3);
    const g = gx * gx + gy * gy;
    if (g > bg) { bg = g; bx = x; by = y; }
  }

  // Bords SILHOUETTE/ciel choisis a la main (achromatiques du cote sombre, la
  // ou la frange coloree de dispersion se lit sans ambiguite) + le bord auto.
  const CROPS = [
    { id: "auto", x: bx, y: by },
    { id: "toit", x: 410, y: 150 },
    { id: "gauche", x: 350, y: 120 },
    { id: "droite", x: 545, y: 160 },
  ];

  const versDataUrl = (frame) => {
    const c = document.createElement("canvas"); c.width = frame.width; c.height = frame.height;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
    return c.toDataURL("image/png");
  };
  const cropDataUrl = (frame, cx, cy) => {
    const w = frame.width, h = frame.height;
    const x0 = Math.max(0, Math.min(w - S, cx - (S >> 1)));
    const y0 = Math.max(0, Math.min(h - S, cy - (S >> 1)));
    const src = new Uint8ClampedArray(frame.pixels);
    const sub = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++)
      sub.set(src.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + S) * 4), y * S * 4);
    const c = document.createElement("canvas"); c.width = S; c.height = S;
    c.getContext("2d").putImageData(new ImageData(sub, S, S), 0, 0);
    return c.toDataURL("image/png");
  };
  const stat = (frame) => {
    const p = frame.pixels; let s = 0, s2 = 0; const n = frame.width * frame.height;
    for (let i = 0; i < p.length; i += 4) { const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; s += l; s2 += l * l; }
    const m = s / n; return { moyenne: +m.toFixed(2), ecartType: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(2) };
  };

  const MATIERES = ${JSON.stringify(MATIERES)};
  const DISP = ${JSON.stringify(DISP)};

  const cv = document.createElement("canvas"); cv.width = LW; cv.height = LH;
  const ctx = await initGpu(cv);
  const renderer = new Renderer(ctx, undefined, undefined, () => 0);
  await renderer.loadImage(photo);

  const out = { crop: { x: bx, y: by } };
  for (const mat of MATIERES) for (const dp of DISP) {
    const stack = openDocument(renderer, "fond").stack;
    const lid = stack.addLayer("glass");
    // params EXPLICITES valides pour les deux versions de glass.ts (layout de
    // params identique 30dfd5b^ vs HEAD, verifie). On ne touche que material et
    // dispersion ; le reste reste au defaut du module.
    stack.updateParams(lid, { material: mat.material, dispersion: dp.dispersion });
    const frame = await renderer.exportFrame(stack.layers);
    const crops = {};
    for (const cr of CROPS) crops[cr.id] = cropDataUrl(frame, cr.x, cr.y);
    out[mat.id + "-" + dp.id] = { img: versDataUrl(frame), crops, stat: stat(frame) };
  }
  return JSON.stringify(out);
})()`;

const res = JSON.parse(await evalIn(script, frameCtx.id));
const manifest = { crop: res.crop };
for (const [k, o] of Object.entries(res)) {
  if (k === "crop") continue;
  writeFileSync(path.join(OUT, `q2-${TAG}-${k}.png`), Buffer.from(o.img.split(",")[1], "base64"));
  for (const [cid, durl] of Object.entries(o.crops))
    writeFileSync(path.join(OUT, `q2-${TAG}-${k}-crop-${cid}.png`), Buffer.from(durl.split(",")[1], "base64"));
  manifest[k] = o.stat;
  console.log(`${TAG} ${k.padEnd(12)} moyenne ${String(o.stat.moyenne).padStart(6)}  ecart-type ${String(o.stat.ecartType).padStart(6)}`);
}
writeFileSync(path.join(OUT, `q2-manifest-${TAG}.json`), JSON.stringify(manifest, null, 2));
console.log(`crop centre @ (${res.crop.x}, ${res.crop.y})`);
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
