// Planche de MECANISME 2 ticket 06 (aquarelle v2 ADVECTION) : rend 8 colonnes par
// ablation sur la photo, pleine resolution, par le pipeline REEL (iframe Vite 1421,
// module map vierge : sert aquarelle.ts TEL QU'IL EST SUR LE DISQUE, edition non
// commitee). Par colonne : vignette (par masses, ~620px) et crop 1:1 (256px natifs,
// par pixel), au MEME point que la planche 1 (2496,2496). Ecrit aq2-col<N>-vign.png /
// aq2-col<N>-crop.png + aq2-stats.json. NE TOUCHE PAS aux aq-col*.png de la planche 1.
// Usage : node planche-06-rendu-2.mjs [cropX cropY]
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const PHOTO = "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const VIGN = 620;
const CROP = 256;
const CROP_X = Number(process.argv[2] ?? 2496);
const CROP_Y = Number(process.argv[3] ?? 2496);

// Ablation, un facteur a la fois. Defauts de l'effet : flow 8, fibers 0.55,
// frontWidth 8, bloom 0.15, wash 0.5. Ici on les pose explicitement.
// mode : 0 = Absorbance, 1 = Moyenne (le temoin de melange).
const D = { flow: 8, fibers: 0.55, frontWidth: 8, bloom: 0.15 };
const COLS = [
  { key: "temoin", temoin: true },
  // 1 advection seule : le pigment bouge, rien d'autre. Moyenne, tout mouille, pas de front, pas de lavis.
  { key: "advection", params: { ...D, wash: 0, wetness: 1, edgeDarkening: 0, lace: 0, mode: 1, bloom: 0 } },
  // 2 idem + Absorbance : les noirs restent sombres.
  { key: "absorbance", params: { ...D, wash: 0, wetness: 1, edgeDarkening: 0, lace: 0, mode: 0 } },
  // 3 + plages mouillees (wetness 0.6), front sans assombrissement.
  { key: "plages", params: { ...D, wash: 0, wetness: 0.6, edgeDarkening: 0, lace: 0, mode: 0 } },
  // 4 + front de pigment (edgeDarkening au defaut, lace 0).
  { key: "front", params: { ...D, wash: 0, wetness: 0.6, edgeDarkening: 0.8, lace: 0, mode: 0 } },
  // 5 + dentelle (lace au defaut).
  { key: "dentelle", params: { ...D, wash: 0, wetness: 0.6, edgeDarkening: 0.8, lace: 0.6, mode: 0 } },
  // 6 + lavis (wash au defaut).
  { key: "lavis", params: { ...D, wash: 0.5, wetness: 0.6, edgeDarkening: 0.8, lace: 0.6, mode: 0 } },
  // 7 idem 5 avec flow x2 (bave massive).
  { key: "portee2x", params: { ...D, flow: 16, wash: 0, wetness: 0.6, edgeDarkening: 0.8, lace: 0.6, mode: 0 } },
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

const FRAME_ID = "__planche06Frame2";
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

await evalIn(`window.__aqSetup2 = (async () => {
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
  const { openDocument, r, W, H } = await window.__aqSetup2;
  const col = ${JSON.stringify(col)};
  const stack = openDocument(r, "fond").stack;
  if (!col.temoin) {
    const a = stack.addLayer("aquarelle");
    stack.updateParams(a, col.params);
  }
  const frame = await r.exportFrame(stack.layers);
  const full = document.createElement("canvas");
  full.width = frame.width; full.height = frame.height;
  full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
  const vh = Math.round(${VIGN} * frame.height / frame.width);
  const vc = document.createElement("canvas");
  vc.width = ${VIGN}; vc.height = vh;
  const vctx = vc.getContext("2d");
  vctx.drawImage(full, 0, 0, ${VIGN}, vh);
  const cc = document.createElement("canvas");
  cc.width = ${CROP}; cc.height = ${CROP};
  cc.getContext("2d").drawImage(full, ${CROP_X}, ${CROP_Y}, ${CROP}, ${CROP}, 0, 0, ${CROP}, ${CROP});
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
  return JSON.stringify({ vign: vc.toDataURL("image/png"), crop: cc.toDataURL("image/png"), mean, std, W, H, luma });
})()`;
  return JSON.parse(await evalIn(expr, frameCtx.id));
};

const stats = { cropX: CROP_X, cropY: CROP_Y, cols: [] };
const lumaByCol = [];
for (let i = 0; i < COLS.length; i++) {
  const col = COLS[i];
  const res = await perCol(col);
  const vb = Buffer.from(res.vign.split(",")[1], "base64");
  const cb = Buffer.from(res.crop.split(",")[1], "base64");
  writeFileSync(path.join(OUT, `aq2-col${i}-vign.png`), vb);
  writeFileSync(path.join(OUT, `aq2-col${i}-crop.png`), cb);
  const md5v = createHash("md5").update(vb).digest("hex");
  const md5c = createHash("md5").update(cb).digest("hex");
  stats.cols.push({ i, key: col.key, params: col.params ?? null, mean: res.mean, std: res.std, md5vign: md5v, md5crop: md5c });
  lumaByCol.push(res.luma);
  stats.native = `${res.W}`;
  console.log(`col${i} ${col.key.padEnd(11)} mean=${res.mean.toFixed(2)} std=${res.std.toFixed(2)} md5v=${md5v.slice(0,8)} md5c=${md5c.slice(0,8)}`);
}

// NOIRS PRESERVES : positions des 10% de pixels les plus sombres DU TEMOIN, puis
// luminance moyenne de CES MEMES positions dans chaque colonne. Dit si la
// silhouette noire reste noire (plus le chiffre est bas, plus elle est preservee).
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
console.log(`\ndark10 (luma moyenne des 10% plus sombres du temoin, seuil=${seuil.toFixed(1)}, n=${idxSombres.length}) :`);
for (const c of stats.cols) console.log(`  col${c.i} ${c.key.padEnd(11)} dark10=${c.dark10.toFixed(2)}`);

writeFileSync(path.join(OUT, "aq2-stats.json"), JSON.stringify(stats, null, 2));
console.log("\nstats -> aq2-stats.json ; crop origine natif " + CROP_X + "," + CROP_Y);
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); delete window.__aqSetup2; "ok"`);
ws.close();
