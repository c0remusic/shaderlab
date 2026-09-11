// Planche RENDU du ticket 06 (module colorGrading de l'etage) : le grading
// rendu sur DEUX photos d'Antoine par le pipeline REEL (iframe Vite 1421,
// module map vierge). Pilote par r.setDevelop({ colorGrading: params }) +
// exportFrame(layers, null, develop). Colonnes : teal-and-orange (duo), tons
// moyens vert, global lum, balance, fusion — memes doses que les mesures du
// plugin Lightroom pour comparaison au meme panneau.
// Ecrit grading-{A,B}-col<N>-{vign,crop}.png + grading-stats.json.
// Usage : node planche-06-grading-rendu.mjs   (app CDP 9223 + Vite 1421)
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9223";
const VIGN = 620;
const CROP = 256;

const PHOTOS = {
  A: { file: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG", crop: { x: 2600, y: 2500, label: "petale / fleur rouge" } },
  B: { file: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5169-edited-2.JPG", crop: { x: 1500, y: 2300, label: "main (peau) / orange" } },
};

// Une colonne par reglage. Libelles francais de Lightroom (TSL / Couleur / N&B),
// pour comparer a dose identique. Le module est hsl.
const COLS = [
  { key: "temoin", label: "Temoin (tout a 0)", temoin: true },
  { key: "ombres-bleu", label: "Ombres bleu 220 / sat 60", params: { shadowHue: 220, shadowSat: 60 } },
  { key: "hl-orange", label: "Hautes lumieres orange 40 / sat 60", params: { highlightHue: 40, highlightSat: 60 } },
  { key: "duo", label: "Teal-and-orange (les deux)", params: { shadowHue: 220, shadowSat: 60, highlightHue: 40, highlightSat: 60 } },
  { key: "moyens-vert", label: "Tons moyens vert 120 / sat 60", params: { midtoneHue: 120, midtoneSat: 60 } },
  { key: "global-lum-p50", label: "Luminance globale +50", params: { globalLum: 50 } },
  { key: "global-lum-m50", label: "Luminance globale -50", params: { globalLum: -50 } },
  { key: "balance-p100", label: "Duo + Balance +100", params: { shadowHue: 220, shadowSat: 60, highlightHue: 40, highlightSat: 60, balance: 100 } },
  { key: "balance-m100", label: "Duo + Balance -100", params: { shadowHue: 220, shadowSat: 60, highlightHue: 40, highlightSat: 60, balance: -100 } },
  { key: "fusion-0", label: "Duo + Fusion 0 (tranche)", params: { shadowHue: 220, shadowSat: 60, highlightHue: 40, highlightSat: 60, blending: 0 } },
  { key: "fusion-100", label: "Duo + Fusion 100 (fondu)", params: { shadowHue: 220, shadowSat: 60, highlightHue: 40, highlightSat: 60, blending: 100 } },
  { key: "global-orange", label: "Global orange 40 / sat 40", params: { globalHue: 40, globalSat: 40 } },
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
  const r = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
    ...(contextId === undefined ? {} : { contextId }),
  });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const FRAME_ID = "__planche06Grading";
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

const stats = { photos: {}, cols: COLS.map((c) => ({ key: c.key, label: c.label, params: c.params ?? null })) };

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
    window.__gradSetup = { openDocument, r, W: bmp.width, H: bmp.height };
    return JSON.stringify({ W: bmp.width, H: bmp.height });
  })()`, frameCtx.id));

  const perCol = async (col) => {
    const c = ph.crop;
    const expr = `(async () => {
      const { openDocument, r } = window.__gradSetup;
      const col = ${JSON.stringify(col)};
      const stack = openDocument(r, "fond").stack;
      const develop = col.temoin ? {} : { colorGrading: col.params };
      r.setDevelop(develop);
      const frame = await r.exportFrame(stack.layers, null, develop);
      const full = document.createElement("canvas");
      full.width = frame.width; full.height = frame.height;
      full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
      const vh = Math.round(${VIGN} * frame.height / frame.width);
      const vc = document.createElement("canvas");
      vc.width = ${VIGN}; vc.height = vh;
      const vctx = vc.getContext("2d");
      vctx.drawImage(full, 0, 0, ${VIGN}, vh);
      const cc = document.createElement("canvas"); cc.width = ${CROP}; cc.height = ${CROP};
      cc.getContext("2d").drawImage(full, ${c.x}, ${c.y}, ${CROP}, ${CROP}, 0, 0, ${CROP}, ${CROP});
      const px = vctx.getImageData(0, 0, ${VIGN}, vh).data;
      let s = 0, s2 = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = 0.2126 * px[i] + 0.7152 * px[i+1] + 0.0722 * px[i+2];
        s += l; s2 += l * l; n++;
      }
      const mean = s / n;
      const std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
      return JSON.stringify({ vign: vc.toDataURL("image/png"), crop: cc.toDataURL("image/png"), mean, std, fw: frame.width, fh: frame.height });
    })()`;
    return JSON.parse(await evalIn(expr, frameCtx.id));
  };

  const photoStats = { file: ph.file, srcW: setup.W, srcH: setup.H, frameW: null, frameH: null, crop: ph.crop, cols: [] };
  for (let i = 0; i < COLS.length; i++) {
    const col = COLS[i];
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { res = await perCol(col); break; }
      catch (err) { if (attempt === 2) throw err; await new Promise((r) => setTimeout(r, 4000)); }
    }
    const vb = Buffer.from(res.vign.split(",")[1], "base64");
    const cb = Buffer.from(res.crop.split(",")[1], "base64");
    writeFileSync(path.join(OUT, `grading-${tag}-col${i}-vign.png`), vb);
    writeFileSync(path.join(OUT, `grading-${tag}-col${i}-crop.png`), cb);
    const md5v = createHash("md5").update(vb).digest("hex");
    const md5c = createHash("md5").update(cb).digest("hex");
    photoStats.frameW = res.fw; photoStats.frameH = res.fh;
    photoStats.cols.push({ i, key: col.key, label: col.label, mean: res.mean, std: res.std, md5vign: md5v, md5crop: md5c });
    console.log(`${tag} col${i} ${col.key.padEnd(22)} mean=${res.mean.toFixed(2)} std=${res.std.toFixed(2)} md5v=${md5v.slice(0,8)}`);
  }
  photoStats.exifOk = (photoStats.srcW === photoStats.frameW && photoStats.srcH === photoStats.frameH);
  stats.photos[tag] = photoStats;
  console.log(`${tag} dims src ${photoStats.srcW}x${photoStats.srcH} == frame ${photoStats.frameW}x${photoStats.frameH} -> exifOk=${photoStats.exifOk}`);
  await evalIn(`delete window.__gradSetup; "ok"`, frameCtx.id);
}

writeFileSync(path.join(OUT, "grading-stats.json"), JSON.stringify(stats, null, 2));
console.log("\nstats -> grading-stats.json");
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
