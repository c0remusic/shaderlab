// Mesure factuelle : poids reel de la DISPERSION (dispersion 0.25 vs 0), version
// current (HEAD), sur Poli et Depoli, dans chaque fenetre de crop. Donne un
// chiffre au grief "distortion de la couleur". Aucun swap : glass.ts du disque.
// Aucun accent ni backtick dans le code injecte.
import path from "node:path";
const ORIGIN = "http://localhost:1421";
import { readFileSync } from "node:fs";
const PHOTO = "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg";
const photoB64 = readFileSync(PHOTO).toString("base64");

const targets = await (await fetch("http://localhost:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const contexts = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const evalIn = async (expression, contextId) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId === undefined ? {} : { contextId }) });
  const ex = r.result?.exceptionDetails; if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};
const FRAME_ID = "__q2mesure";
const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res) => { document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); const f=document.createElement("iframe"); f.id=${JSON.stringify(FRAME_ID)}; f.style.cssText="position:absolute;left:-9999px;width:16px;height:16px"; f.src=${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)}; f.onload=()=>res("ok"); document.body.appendChild(f); })`);
await new Promise((r) => setTimeout(r, 400));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || (c.auxData && c.auxData.type === "iframe")));
await evalIn(`window.__pp = []; "ok"`, frameCtx.id);
for (let i = 0; i < photoB64.length; i += 2_000_000) await evalIn(`window.__pp.push(${JSON.stringify(photoB64.slice(i, i + 2_000_000))}); "ok"`, frameCtx.id);

const CROPS = [{ id: "auto", x: 293, y: 230 }, { id: "toit", x: 410, y: 150 }, { id: "gauche", x: 350, y: 120 }, { id: "droite", x: 545, y: 160 }];
const out = await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__pp.join("")); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const LW = 640, LH = Math.round((LW * bmp.height) / bmp.width);
  const cvp = document.createElement("canvas"); cvp.width = LW; cvp.height = LH; cvp.getContext("2d").drawImage(bmp, 0, 0, LW, LH);
  const photo = await createImageBitmap(cvp);
  const cv = document.createElement("canvas"); cv.width = LW; cv.height = LH;
  const ctx = await initGpu(cv); const r = new Renderer(ctx, undefined, undefined, () => 0); await r.loadImage(photo);
  const rendu = async (material, dispersion) => { const s = openDocument(r, "fond").stack; const l = s.addLayer("glass"); s.updateParams(l, { material, dispersion }); const f = await r.exportFrame(s.layers); return new Uint8Array(f.pixels); };
  const S = 128, CROPS = ${JSON.stringify(CROPS)};
  const diffCrop = (a, b, cx, cy) => {
    const x0 = Math.max(0, Math.min(LW - S, cx - (S >> 1))), y0 = Math.max(0, Math.min(LH - S, cy - (S >> 1)));
    let nRGB = 0, somRGB = 0, maxRGB = 0, tot = 0, nChroma = 0, somChroma = 0;
    for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
      const i = ((y0 + yy) * LW + (x0 + xx)) * 4;
      // chroma = variation du SPREAD des canaux (max-min), ce qui bouge quand une
      // frange coloree apparait sans changer la luminance.
      const spA = Math.max(a[i], a[i+1], a[i+2]) - Math.min(a[i], a[i+1], a[i+2]);
      const spB = Math.max(b[i], b[i+1], b[i+2]) - Math.min(b[i], b[i+1], b[i+2]);
      const dChroma = Math.abs(spA - spB); somChroma += dChroma; if (dChroma > 1) nChroma++;
      for (let k = 0; k < 3; k++) { const d = Math.abs(a[i+k] - b[i+k]); tot++; somRGB += d; if (d > 1) nRGB++; if (d > maxRGB) maxRGB = d; }
    }
    return { pctRGB: +(100 * nRGB / tot).toFixed(2), moyRGB: +(somRGB / tot).toFixed(2), maxRGB, pctChroma: +(100 * nChroma / (S*S)).toFixed(2), moyChroma: +(somChroma / (S*S)).toFixed(2) };
  };
  const res = {};
  for (const [mat, mid] of [[6, "poli"], [7, "depoli"]]) {
    const a = await rendu(mat, 0.25), b = await rendu(mat, 0);
    res[mid] = {}; for (const cr of CROPS) res[mid][cr.id] = diffCrop(a, b, cr.x, cr.y);
  }
  return JSON.stringify(res);
})()`, frameCtx.id);
console.log("Dispersion 0.25 vs 0 (current) — diff par crop:");
const parsed = JSON.parse(out);
for (const [mat, crops] of Object.entries(parsed)) {
  console.log("  " + mat + ":");
  for (const [cid, d] of Object.entries(crops))
    console.log(`    ${cid.padEnd(8)} RGB: ${String(d.pctRGB).padStart(6)}% pixels, moy ${String(d.moyRGB).padStart(5)}, max ${String(d.maxRGB).padStart(3)}  |  chroma: ${String(d.pctChroma).padStart(6)}% px, moy ${d.moyChroma}`);
}
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
