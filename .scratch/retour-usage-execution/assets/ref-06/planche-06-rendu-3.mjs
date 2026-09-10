// Planche de MECANISME 3 ticket 06 (aquarelle v3 CHAINE COMBINEE) : rend 9 colonnes
// par ablation CUMULATIVE sur la photo, pleine resolution, par le pipeline REEL
// (iframe Vite 1421, module map vierge : sert aquarelle.ts TEL QU'IL EST SUR LE
// DISQUE). Par colonne : vignette (~620px, par masses), crop agave 1:1 (256px natifs,
// 2496,2496) et crop CIEL 1:1 (256px natifs, 2200,500 : bande de nuages, teintes
// proches). Ecrit aq3-col<N>-{vign,crop,sky}.png + aq3-stats.json. NE TOUCHE PAS aux
// aq-col*.png / aq2-col*.png.
// Usage : node planche-06-rendu-3.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const PHOTO = "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const VIGN = 620;
const CROP = 256;
const CROP_X = 2496, CROP_Y = 2496;       // agave / soleil (comme planches 1 et 2)
const SKY_X = 2200, SKY_Y = 500;          // bande de nuages orange/bleu, teintes proches

// Valeurs FRANCHES fixes hors du facteur ablate. spread baseline 1.5 (col7 = x2).
const D = { washRadius: 5, spread: 1.5, frontWidth: 8, bloom: 0.15 };
const COLS = [
  { key: "temoin", temoin: true },
  // 1 lavis seul : la photo devient des aplats. Aucune bave, aucun front.
  { key: "lavis", params: { ...D, wash: 1, wetness: 0, fibers: 0, edgeDarkening: 0, lace: 0, bloom: 0 } },
  // 2 + bave : les aplats fusent (pyramide de diffusion, tout mouille).
  { key: "bave", params: { ...D, wash: 1, wetness: 1, fibers: 0, edgeDarkening: 0, lace: 0 } },
  // 3 + fibres : les bords s'effilochent (advection HF).
  { key: "fibres", params: { ...D, wash: 1, wetness: 1, fibers: 4, edgeDarkening: 0, lace: 0 } },
  // 4 + plages : mouille 0.6, net dehors, bave dedans.
  { key: "plages", params: { ...D, wash: 1, wetness: 0.6, fibers: 4, edgeDarkening: 0, lace: 0 } },
  // 5 + front de pigment (edgeDarkening au defaut, lace 0).
  { key: "front", params: { ...D, wash: 1, wetness: 0.6, fibers: 4, edgeDarkening: 0.9, lace: 0 } },
  // 6 + dentelle : LA colonne "tout".
  { key: "tout", params: { ...D, wash: 1, wetness: 0.6, fibers: 4, edgeDarkening: 0.9, lace: 0.6 } },
  // 7 tout, spread x2 (bave massive).
  { key: "portee2x", params: { ...D, spread: 3.0, wash: 1, wetness: 0.6, fibers: 4, edgeDarkening: 0.9, lace: 0.6 } },
  // 8 tout, SANS lavis (wash 0) : pour voir ce que le lavis apporte.
  { key: "sanslavis", params: { ...D, wash: 0, wetness: 0.6, fibers: 4, edgeDarkening: 0.9, lace: 0.6 } },
];

const photoB64 = readFileSync(PHOTO).toString("base64");
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

const FRAME_ID = "__planche06Frame3";
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
await new Promise((r) => setTimeout(r, 300));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
if (!frameCtx) throw new Error("contexte iframe introuvable");

await evalIn(`window.__photoParts = []; "ok"`, frameCtx.id);
const CHUNK = 2_000_000;
for (let i = 0; i < photoB64.length; i += CHUNK) {
  await evalIn(`window.__photoParts.push(${JSON.stringify(photoB64.slice(i, i + CHUNK))}); "ok"`, frameCtx.id);
}

await evalIn(`window.__aqSetup3 = (async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const b64 = window.__photoParts.join("");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = await initGpu(cv);
  const r = new Renderer(ctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  return { openDocument, r, W: bmp.width, H: bmp.height };
})(); "ok"`, frameCtx.id);

const perCol = async (col) => {
  const expr = `(async () => {
  const { openDocument, r, W, H } = await window.__aqSetup3;
  const col = ${JSON.stringify(col)};
  const stack = openDocument(r, "fond").stack;
  let t0 = performance.now();
  if (!col.temoin) {
    const a = stack.addLayer("aquarelle");
    stack.updateParams(a, col.params);
  }
  const frame = await r.exportFrame(stack.layers);
  const ms = performance.now() - t0;
  const full = document.createElement("canvas");
  full.width = frame.width; full.height = frame.height;
  full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
  const vh = Math.round(${VIGN} * frame.height / frame.width);
  const vc = document.createElement("canvas");
  vc.width = ${VIGN}; vc.height = vh;
  const vctx = vc.getContext("2d");
  vctx.drawImage(full, 0, 0, ${VIGN}, vh);
  const crop = (x, y) => { const cc = document.createElement("canvas"); cc.width = ${CROP}; cc.height = ${CROP};
    cc.getContext("2d").drawImage(full, x, y, ${CROP}, ${CROP}, 0, 0, ${CROP}, ${CROP}); return cc.toDataURL("image/png"); };
  const px = vctx.getImageData(0, 0, ${VIGN}, vh).data;
  const luma = new Array(px.length / 4);
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i+1] + 0.0722 * px[i+2];
    luma[i >> 2] = l;
    s += l; s2 += l * l; n++;
  }
  const mean = s / n;
  const std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  return JSON.stringify({ vign: vc.toDataURL("image/png"), crop: crop(${CROP_X}, ${CROP_Y}), sky: crop(${SKY_X}, ${SKY_Y}), mean, std, W, H, luma, ms });
})()`;
  return JSON.parse(await evalIn(expr, frameCtx.id));
};

const stats = { cropX: CROP_X, cropY: CROP_Y, skyX: SKY_X, skyY: SKY_Y, cols: [] };
const lumaByCol = [];
for (let i = 0; i < COLS.length; i++) {
  const col = COLS[i];
  const res = await perCol(col);
  const vb = Buffer.from(res.vign.split(",")[1], "base64");
  const cb = Buffer.from(res.crop.split(",")[1], "base64");
  const sb = Buffer.from(res.sky.split(",")[1], "base64");
  writeFileSync(path.join(OUT, `aq3-col${i}-vign.png`), vb);
  writeFileSync(path.join(OUT, `aq3-col${i}-crop.png`), cb);
  writeFileSync(path.join(OUT, `aq3-col${i}-sky.png`), sb);
  const md5v = createHash("md5").update(vb).digest("hex");
  const md5c = createHash("md5").update(cb).digest("hex");
  const md5s = createHash("md5").update(sb).digest("hex");
  stats.cols.push({ i, key: col.key, params: col.params ?? null, mean: res.mean, std: res.std, ms: res.ms, md5vign: md5v, md5crop: md5c, md5sky: md5s });
  lumaByCol.push(res.luma);
  stats.native = `${res.W}`;
  console.log(`col${i} ${col.key.padEnd(11)} mean=${res.mean.toFixed(2)} std=${res.std.toFixed(2)} ms=${res.ms.toFixed(1)} md5v=${md5v.slice(0,8)}`);
}

// NOIRS PRESERVES : 10% de pixels les plus sombres DU TEMOIN, luma moyenne aux
// MEMES positions par colonne (plus bas = silhouette noire preservee).
const temoinLuma = lumaByCol[0];
const trie = [...temoinLuma].sort((a, b) => a - b);
const seuil = trie[Math.floor(trie.length * 0.10)];
const idxSombres = [];
for (let j = 0; j < temoinLuma.length; j++) if (temoinLuma[j] <= seuil) idxSombres.push(j);
for (let i = 0; i < stats.cols.length; i++) {
  const l = lumaByCol[i];
  let s = 0;
  for (const j of idxSombres) s += l[j];
  stats.cols[i].dark10 = s / idxSombres.length;
}
stats.dark10Seuil = seuil;
stats.dark10N = idxSombres.length;
console.log(`\ndark10 (seuil=${seuil.toFixed(1)}, n=${idxSombres.length}) :`);
for (const c of stats.cols) console.log(`  col${c.i} ${c.key.padEnd(11)} dark10=${c.dark10.toFixed(2)}`);

writeFileSync(path.join(OUT, "aq3-stats.json"), JSON.stringify(stats, null, 2));
console.log("\nstats -> aq3-stats.json");
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); delete window.__aqSetup3; "ok"`);
ws.close();
