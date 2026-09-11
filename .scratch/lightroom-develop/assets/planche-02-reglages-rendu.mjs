// Planche RENDU du ticket 02 (reglagesDeBase) : le module rendu sur DEUX photos
// d'Antoine par le pipeline REEL (iframe Vite 1421, module map vierge -> sert le
// disque non commite compris). Le module vit dans l'ETAGE, donc on le pilote par
// r.setDevelop({ reglagesDeBase: params }) + exportFrame(layers, null, develop) —
// PAS un calque. Une colonne par reglage a comparer au meme panneau dans Lightroom.
// Par ligne : vignette (~620, par masses) + crop 1:1 (256 natif) sur la peau, la
// ou Texture/Clarte/Vibrance se jugent. Orientation EXIF from-image (dims verifiees).
// Ecrit rb-{A,B}-col<N>-{vign,crop}.png + rb-stats.json.
// Usage : node planche-02-reglages-rendu.mjs   (app sur CDP 9223 + Vite worktree 1421)
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
  B: { file: "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5169-edited-2.JPG", crop: { x: 1500, y: 2300, label: "main (peau) / bande" } },
};

// Une colonne par reglage. Libelles francais de Lightroom, pour comparer a dose
// identique. Le module est reglagesDeBase.
const COLS = [
  { key: "temoin", label: "Temoin (tout a 0)", temoin: true },
  { key: "expo-moins", label: "Exposition -1", params: { exposure: -1 } },
  { key: "expo-plus", label: "Exposition +1", params: { exposure: 1 } },
  { key: "hl-moins", label: "Hautes lumieres -80", params: { highlights: -80 } },
  { key: "ombres-plus", label: "Ombres +80", params: { shadows: 80 } },
  { key: "blancs-noirs", label: "Blancs +50 / Noirs -50", params: { whites: 50, blacks: -50 } },
  { key: "contraste", label: "Contraste +60", params: { contrast: 60 } },
  { key: "texture", label: "Texture +80", params: { texture: 80 } },
  { key: "clarte", label: "Clarte +80", params: { clarity: 80 } },
  { key: "voile-plus", label: "Correction du voile +60", params: { dehaze: 60 } },
  { key: "voile-moins", label: "Correction du voile -60", params: { dehaze: -60 } },
  { key: "vibrance", label: "Vibrance +80", params: { vibrance: 80 } },
  { key: "saturation", label: "Saturation +80", params: { saturation: 80 } },
  { key: "temp-moins", label: "Temperature -50", params: { temperature: -50 } },
  { key: "temp-plus", label: "Temperature +50", params: { temperature: 50 } },
  { key: "nuance-moins", label: "Nuance -50", params: { nuance: -50 } },
  { key: "nuance-plus", label: "Nuance +50", params: { nuance: 50 } },
  { key: "courbe", label: "Courbe param. (HL -60, Ombres +60)", params: { paramHighlights: -60, paramShadows: 60 } },
  { key: "look", label: "Look combine", params: { exposure: 0.3, contrast: 25, highlights: -40, shadows: 30, clarity: 25, vibrance: 40, temperature: 15, paramShadows: 20, paramHighlights: -15 } },
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

const FRAME_ID = "__planche02Reglages";
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
    window.__rbSetup = { openDocument, r, W: bmp.width, H: bmp.height };
    return JSON.stringify({ W: bmp.width, H: bmp.height });
  })()`, frameCtx.id));

  const perCol = async (col) => {
    const c = ph.crop;
    const expr = `(async () => {
      const { openDocument, r } = window.__rbSetup;
      const col = ${JSON.stringify(col)};
      const stack = openDocument(r, "fond").stack;
      const develop = col.temoin ? {} : { reglagesDeBase: col.params };
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
    writeFileSync(path.join(OUT, `rb-${tag}-col${i}-vign.png`), vb);
    writeFileSync(path.join(OUT, `rb-${tag}-col${i}-crop.png`), cb);
    const md5v = createHash("md5").update(vb).digest("hex");
    const md5c = createHash("md5").update(cb).digest("hex");
    photoStats.frameW = res.fw; photoStats.frameH = res.fh;
    photoStats.cols.push({ i, key: col.key, label: col.label, mean: res.mean, std: res.std, md5vign: md5v, md5crop: md5c });
    console.log(`${tag} col${i} ${col.key.padEnd(22)} mean=${res.mean.toFixed(2)} std=${res.std.toFixed(2)} md5v=${md5v.slice(0,8)}`);
  }
  photoStats.exifOk = (photoStats.srcW === photoStats.frameW && photoStats.srcH === photoStats.frameH);
  stats.photos[tag] = photoStats;
  console.log(`${tag} dims src ${photoStats.srcW}x${photoStats.srcH} == frame ${photoStats.frameW}x${photoStats.frameH} -> exifOk=${photoStats.exifOk}`);
  await evalIn(`delete window.__rbSetup; "ok"`, frameCtx.id);
}

writeFileSync(path.join(OUT, "rb-stats.json"), JSON.stringify(stats, null, 2));
console.log("\nstats -> rb-stats.json");
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
