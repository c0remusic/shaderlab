// Planche de MECANISME 6 ticket 06 (aquarelle v5, aquarelle.ts sur disque) : la
// bave devient LOCALE aux frontieres entre lavis. Rendu sur DEUX photos d'Antoine
// par le pipeline REEL (iframe Vite 1421, module map vierge : sert aquarelle.ts tel
// qu'il est). Neuf colonnes rendues ici (0..8) ; la colonne 9 (rappel planche 5
// col2, bave GLOBALE v4) est ajoutee par l'assembleur a partir des PNG aq5-*.
// Par ligne : vignette (~620, par masses) + vue MI-ECHELLE (~1200, crop central,
// c'est la que la bave locale se lit) + deux crops 1:1 (256 natif, memes coords que
// la planche 5). Orientation EXIF respectee (from-image ; dims verifiees = source).
// Ecrit aq6-{A,B}-col<N>-{vign,mid,crop1,crop2}.png + aq6-stats.json.
// Ne touche a aucun aq-/aq2-/aq3-/aq4-/aq5-*.
// Usage : node planche-06-rendu-6.mjs   (app sur CDP 9222 + Vite worktree sur 1421)
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const VIGN = 620;
const MIDW = 1200;
const CROP = 256;

const PHOTOS = {
  A: {
    file: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG",
    crop1: { x: 2600, y: 2500, label: "petale blanc / fleur rouge" },
    crop2: { x: 3600, y: 720, label: "brin vert / petale clair" },
  },
  B: {
    file: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5169-edited-2.JPG",
    crop1: { x: 2990, y: 1470, label: "bord de bande bleue / sombre" },
    crop2: { x: 1500, y: 2300, label: "main (noir) / bande" },
  },
};

// Defauts de reference. La bave est desormais LOCALE : bleedWidth borne la bande de
// frontiere, l'interieur des lavis reste plat. Les colonnes 1-6 ont papier 0 ; le
// papier est ajoute en 7/8 seulement.
const BASE = {
  wash: 0.85, washRadius: 0.005, spread: 2.0, wetness: 0.7, fibers: 0,
  edgeDarkening: 0, frontWidth: 0.003, lace: 0.6, bloom: 0.15, paper: 0, bleedWidth: 0.02,
};

// 0 temoin ; 1 lavis seul (reference) ; 2-4 bave aux frontieres 1/2/4 % ; 5 + fibres ;
// 6 + front ; 7 + papier 0,5 ; 8 + papier 1. (col 9 = rappel v4 global, ajoute par
// l'assembleur depuis aq5-*-col2.)
const COLS = [
  { key: "temoin", temoin: true },
  { key: "lavis",    params: { ...BASE, wetness: 0 } },
  { key: "bave1",    params: { ...BASE, bleedWidth: 0.01 } },
  { key: "bave2",    params: { ...BASE, bleedWidth: 0.02 } },
  { key: "bave4",    params: { ...BASE, bleedWidth: 0.04 } },
  { key: "fibres",   params: { ...BASE, bleedWidth: 0.02, fibers: 0.0015 } },
  { key: "front",    params: { ...BASE, bleedWidth: 0.02, fibers: 0.0015, edgeDarkening: 0.9 } },
  { key: "papier05", params: { ...BASE, bleedWidth: 0.02, fibers: 0.0015, edgeDarkening: 0.9, paper: 0.5 } },
  { key: "papier1",  params: { ...BASE, bleedWidth: 0.02, fibers: 0.0015, edgeDarkening: 0.9, paper: 1 } },
];

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

const FRAME_ID = "__planche06Frame6";
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

const stats = { photos: {}, cols: COLS.map((c) => ({ key: c.key, params: c.params ?? null })) };

const injectSetup = async () => {
  await evalIn(`(async () => { if (!window.__aqSetup6) {
    const { initGpu } = await import("/src/render/gpuContext.ts");
    const { Renderer } = await import("/src/render/renderer.ts");
    const { openDocument } = await import("/src/layers/openedDocument.ts");
    const b64 = window.__photoParts.join(""); const bin = atob(b64);
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
    const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
    const ctx = await initGpu(cv); const r = new Renderer(ctx, undefined, undefined, () => 0);
    await r.loadImage(bmp); window.__aqSetup6 = { openDocument, r, W: bmp.width, H: bmp.height };
  } return "ok"; })()`, frameCtx.id);
};

for (const [tag, ph] of Object.entries(PHOTOS)) {
  const photoB64 = readFileSync(ph.file).toString("base64");
  await evalIn(`window.__photoParts = []; "ok"`, frameCtx.id);
  const CHUNK = 2_000_000;
  for (let i = 0; i < photoB64.length; i += CHUNK) {
    await evalIn(`window.__photoParts.push(${JSON.stringify(photoB64.slice(i, i + CHUNK))}); "ok"`, frameCtx.id);
  }
  const setup = JSON.parse(await evalIn(`(async () => {
    const { initGpu } = await import("/src/render/gpuContext.ts");
    const { Renderer } = await import("/src/render/renderer.ts");
    const { openDocument } = await import("/src/layers/openedDocument.ts");
    const b64 = window.__photoParts.join("");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
    const cv = document.createElement("canvas");
    cv.width = bmp.width; cv.height = bmp.height;
    const ctx = await initGpu(cv);
    const r = new Renderer(ctx, undefined, undefined, () => 0);
    await r.loadImage(bmp);
    window.__aqSetup6 = { openDocument, r, W: bmp.width, H: bmp.height };
    return JSON.stringify({ W: bmp.width, H: bmp.height });
  })()`, frameCtx.id));

  const perCol = async (col) => {
    const c1 = ph.crop1, c2 = ph.crop2;
    const expr = `(async () => {
    const { openDocument, r, W, H } = window.__aqSetup6;
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
    // MI-ECHELLE : crop central (~38 % de la largeur, aspect image conserve) rendu a
    // ${MIDW} px de large -> facteur ~0,5 de la resolution native. C'est la que la
    // bave locale a la frontiere se lit.
    const midRW = Math.round(frame.width * 0.38);
    const midRH = Math.round(midRW * frame.height / frame.width);
    const midRX = Math.round((frame.width - midRW) / 2);
    const midRY = Math.round((frame.height - midRH) / 2);
    const midH = Math.round(${MIDW} * midRH / midRW);
    const mc = document.createElement("canvas"); mc.width = ${MIDW}; mc.height = midH;
    mc.getContext("2d").drawImage(full, midRX, midRY, midRW, midRH, 0, 0, ${MIDW}, midH);
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
    return JSON.stringify({ vign: vc.toDataURL("image/png"), mid: mc.toDataURL("image/png"), crop1: crop(${c1.x}, ${c1.y}), crop2: crop(${c2.x}, ${c2.y}), mean, std, fw: frame.width, fh: frame.height, midW: ${MIDW}, midH, luma, ms });
  })()`;
    return JSON.parse(await evalIn(expr, frameCtx.id));
  };

  const photoStats = { file: ph.file, srcW: setup.W, srcH: setup.H, frameW: null, frameH: null,
    crop1: ph.crop1, crop2: ph.crop2, cols: [] };
  const lumaByCol = [];
  for (let i = 0; i < COLS.length; i++) {
    const col = COLS[i];
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { res = await perCol(col); break; }
      catch (err) {
        if (attempt === 2) throw err;
        console.log(`  [retry ${tag} col${i}] ${String(err).slice(0, 80)} — attente 5s`);
        await new Promise((r) => setTimeout(r, 5000));
        await injectSetup().catch(() => {});
      }
    }
    const vb = Buffer.from(res.vign.split(",")[1], "base64");
    const mb = Buffer.from(res.mid.split(",")[1], "base64");
    const c1b = Buffer.from(res.crop1.split(",")[1], "base64");
    const c2b = Buffer.from(res.crop2.split(",")[1], "base64");
    writeFileSync(path.join(OUT, `aq6-${tag}-col${i}-vign.png`), vb);
    writeFileSync(path.join(OUT, `aq6-${tag}-col${i}-mid.png`), mb);
    writeFileSync(path.join(OUT, `aq6-${tag}-col${i}-crop1.png`), c1b);
    writeFileSync(path.join(OUT, `aq6-${tag}-col${i}-crop2.png`), c2b);
    const md5v = createHash("md5").update(vb).digest("hex");
    const md5m = createHash("md5").update(mb).digest("hex");
    const md5c1 = createHash("md5").update(c1b).digest("hex");
    const md5c2 = createHash("md5").update(c2b).digest("hex");
    photoStats.frameW = res.fw; photoStats.frameH = res.fh;
    photoStats.cols.push({ i, key: col.key, mean: res.mean, std: res.std, ms: res.ms, midW: res.midW, midH: res.midH, md5vign: md5v, md5mid: md5m, md5crop1: md5c1, md5crop2: md5c2 });
    lumaByCol.push(res.luma);
    console.log(`${tag} col${i} ${col.key.padEnd(9)} mean=${res.mean.toFixed(2)} std=${res.std.toFixed(2)} ms=${res.ms.toFixed(1)} md5v=${md5v.slice(0,8)}`);
  }
  const temoinLuma = lumaByCol[0];
  const trie = [...temoinLuma].sort((a, b) => a - b);
  const seuil = trie[Math.floor(trie.length * 0.10)];
  const idxSombres = [];
  for (let j = 0; j < temoinLuma.length; j++) if (temoinLuma[j] <= seuil) idxSombres.push(j);
  for (let i = 0; i < photoStats.cols.length; i++) {
    const l = lumaByCol[i]; let s = 0;
    for (const j of idxSombres) s += l[j];
    photoStats.cols[i].dark10 = s / idxSombres.length;
  }
  photoStats.dark10Seuil = seuil; photoStats.dark10N = idxSombres.length;
  photoStats.exifOk = (photoStats.srcW === photoStats.frameW && photoStats.srcH === photoStats.frameH);
  stats.photos[tag] = photoStats;
  console.log(`${tag} dims src ${photoStats.srcW}x${photoStats.srcH} == frame ${photoStats.frameW}x${photoStats.frameH} -> exifOk=${photoStats.exifOk}`);
  console.log(`${tag} dark10 (seuil=${seuil.toFixed(1)}, n=${idxSombres.length}) : ${photoStats.cols.map((c) => c.dark10.toFixed(1)).join(" ")}`);
  await evalIn(`delete window.__aqSetup6; "ok"`, frameCtx.id);
}

writeFileSync(path.join(OUT, "aq6-stats.json"), JSON.stringify(stats, null, 2));
console.log("\nstats -> aq6-stats.json");
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
