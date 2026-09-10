// Planche de MECANISME ticket 06 (aquarelle) : rend 8 colonnes par ablation sur
// la photo, pleine resolution, par le pipeline REEL (iframe Vite 1421, module map
// vierge : sert aquarelle.ts TEL QU'IL EST SUR LE DISQUE, edition non commitee).
// Par colonne : une vignette (par masses, ~620px) et un crop 1:1 (256 px natifs,
// par pixel). Ecrit aq-col<N>-vign.png / aq-col<N>-crop.png + aq-stats.json.
// Usage : node planche-06-rendu.mjs [cropX cropY]
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const PHOTO = "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const VIGN = 620;
const CROP = 256;
const CROP_X = Number(process.argv[2] ?? 1950);
const CROP_Y = Number(process.argv[3] ?? 2120);
const SPREAD = 1.5;

// Colonnes : ablation, un facteur a la fois. temoin = photo nue (pas de calque).
const COLS = [
  { key: "temoin", temoin: true },
  { key: "diffusion", params: { spread: SPREAD, wetness: 1, wobble: 0, edgeDarkening: 0, lace: 0, densityMode: 0 } },
  { key: "wobble", params: { spread: SPREAD, wetness: 1, wobble: 16, edgeDarkening: 0, lace: 0, densityMode: 0 } },
  { key: "front", params: { spread: SPREAD, wetness: 1, wobble: 16, edgeDarkening: 0.9, lace: 0, densityMode: 0 } },
  { key: "dentelle", params: { spread: SPREAD, wetness: 1, wobble: 16, edgeDarkening: 0.9, lace: 0.6, densityMode: 0 } },
  { key: "densite", params: { spread: SPREAD, wetness: 1, wobble: 16, edgeDarkening: 0.9, lace: 0.6, densityMode: 1 } },
  { key: "portee2x", params: { spread: SPREAD * 2, wetness: 1, wobble: 16, edgeDarkening: 0.9, lace: 0.6, densityMode: 1 } },
  { key: "plages", params: { spread: SPREAD, wetness: 0.5, wobble: 16, edgeDarkening: 0.9, lace: 0.6, densityMode: 1 } },
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

const FRAME_ID = "__planche06Frame";
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

// Prepare le renderer + la photo UNE fois, garde-le sur window pour les colonnes.
await evalIn(`window.__aqSetup = (async () => {
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
  const { openDocument, r, W, H } = await window.__aqSetup;
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
  // vignette (par masses)
  const vh = Math.round(${VIGN} * frame.height / frame.width);
  const vc = document.createElement("canvas");
  vc.width = ${VIGN}; vc.height = vh;
  const vctx = vc.getContext("2d");
  vctx.drawImage(full, 0, 0, ${VIGN}, vh);
  // crop 1:1 natif (par pixel)
  const cc = document.createElement("canvas");
  cc.width = ${CROP}; cc.height = ${CROP};
  cc.getContext("2d").drawImage(full, ${CROP_X}, ${CROP_Y}, ${CROP}, ${CROP}, 0, 0, ${CROP}, ${CROP});
  // stats de luminance sur la vignette
  const px = vctx.getImageData(0, 0, ${VIGN}, vh).data;
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i+1] + 0.0722 * px[i+2];
    s += l; s2 += l * l; n++;
  }
  const mean = s / n;
  const std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  return JSON.stringify({ vign: vc.toDataURL("image/png"), crop: cc.toDataURL("image/png"), mean, std, W, H });
})()`;
  return JSON.parse(await evalIn(expr, frameCtx.id));
};

const stats = { cropX: CROP_X, cropY: CROP_Y, cols: [] };
for (let i = 0; i < COLS.length; i++) {
  const col = COLS[i];
  const res = await perCol(col);
  const vb = Buffer.from(res.vign.split(",")[1], "base64");
  const cb = Buffer.from(res.crop.split(",")[1], "base64");
  writeFileSync(path.join(OUT, `aq-col${i}-vign.png`), vb);
  writeFileSync(path.join(OUT, `aq-col${i}-crop.png`), cb);
  const md5v = createHash("md5").update(vb).digest("hex");
  const md5c = createHash("md5").update(cb).digest("hex");
  stats.cols.push({ i, key: col.key, params: col.params ?? null, mean: res.mean, std: res.std, md5vign: md5v, md5crop: md5c });
  console.log(`col${i} ${col.key.padEnd(10)} mean=${res.mean.toFixed(2)} std=${res.std.toFixed(2)} md5v=${md5v.slice(0,8)} md5c=${md5c.slice(0,8)}`);
}
stats.native = `${stats.cols[0]?.W ?? "?"}`;
writeFileSync(path.join(OUT, "aq-stats.json"), JSON.stringify(stats, null, 2));
console.log("stats -> aq-stats.json ; crop origine natif " + CROP_X + "," + CROP_Y);
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); delete window.__aqSetup; "ok"`);
ws.close();
