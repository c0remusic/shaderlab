// Planche 24 — rendu DIRECT par exportFrame (voie B + temoin).
// Le transform de la voie B vit dans le SHADER (edition temporaire de
// shaderCompose.ts faite AVANT ce run par voieB-edit.mjs). Ce script ne fait que
// rendre les trois scenes via le pipeline reel (iframe 1421, module map vierge :
// sert shaderCompose.ts TEL QU'IL EST SUR LE DISQUE, edition non commitee comprise).
// Usage : node planche-24-render.mjs <prefixe>
// Ecrit planche24-<prefixe>-<scene>.png et planche24-stats-<prefixe>.json
// Aucun accent ni backtick dans le code evalue dans la page.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PREFIXE = process.argv[2];
if (!PREFIXE) throw new Error("usage: node planche-24-render.mjs <prefixe>");
const PHOTO = "C:\\Users\\LEETJ\\Pictures\\vram-test\\photo-1.jpg";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";

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

const FRAME_ID = "__planche24Frame";
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

const script = `(async () => {
  const O = ${JSON.stringify(ORIGIN)};
  const { initGpu } = await import(O + "/src/render/gpuContext.ts");
  const { Renderer } = await import(O + "/src/render/renderer.ts");
  const { openDocument } = await import(O + "/src/layers/openedDocument.ts");

  const mireBokeh = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    const rayons = [1, 2, 3, 5];
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
      const cx = ((col + 0.5) * w) / 4, cy = ((row + 0.5) * h) / 4;
      const rr = rayons[col];
      for (let y = Math.floor(cy - rr); y <= cy + rr; y++)
        for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if ((x - cx) ** 2 + (y - cy) ** 2 > rr * rr) continue;
          const i = (y * w + x) * 4;
          d[i] = row === 0 || row === 3 ? 255 : 90;
          d[i + 1] = row === 1 || row === 3 ? 255 : 90;
          d[i + 2] = row === 2 || row === 3 ? 255 : 90;
        }
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };
  const mireEncre = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    let graine = 20260805 >>> 0;
    const suivant = () => { graine = (graine * 1664525 + 1013904223) >>> 0; return graine / 4294967296; };
    const grandes = new Float64Array(64);
    for (let i = 0; i < grandes.length; i++) grandes[i] = suivant();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cellule = grandes[(Math.floor(y / 32) % 8) * 8 + (Math.floor(x / 32) % 8)];
      const bandes = 0.5 + 0.5 * Math.sin((x + y) * 0.19);
      const fin = suivant();
      const v = Math.round((0.42 * cellule + 0.33 * bandes + 0.25 * fin) * 255);
      const i = (y * w + x) * 4;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    return createImageBitmap(new ImageData(d, w, h));
  };

  const b64 = window.__photoParts.join("");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const LW = 512;
  const LH = Math.round((LW * bmp.height) / bmp.width);
  const cvp = document.createElement("canvas");
  cvp.width = LW; cvp.height = LH;
  cvp.getContext("2d").drawImage(bmp, 0, 0, LW, LH);
  const photo = await createImageBitmap(cvp);

  const versDataUrl = (frame) => {
    const c = document.createElement("canvas");
    c.width = frame.width; c.height = frame.height;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
    return c.toDataURL("image/png");
  };
  const cropDataUrl = (frame, y0, y1) => {
    const w = frame.width, hc = y1 - y0;
    const sub = new Uint8ClampedArray(w * hc * 4);
    const src = new Uint8ClampedArray(frame.pixels);
    sub.set(src.subarray(y0 * w * 4, y1 * w * 4));
    const c = document.createElement("canvas");
    c.width = w; c.height = hc;
    c.getContext("2d").putImageData(new ImageData(sub, w, hc), 0, 0);
    return c.toDataURL("image/png");
  };
  const stat = (frame) => {
    const p = frame.pixels; let s = 0, s2 = 0, n = frame.width * frame.height;
    for (let i = 0; i < p.length; i += 4) {
      const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      s += l; s2 += l * l;
    }
    const m = s / n; return { moyenne: +m.toFixed(2), ecartType: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(2) };
  };

  const out = {};

  // Scene 1 : lightLeak sur la photo reelle (champ pur).
  {
    const cv = document.createElement("canvas"); cv.width = LW; cv.height = LH;
    const ctx = await initGpu(cv);
    const r = new Renderer(ctx, undefined, undefined, () => 0);
    await r.loadImage(photo);
    const stack = openDocument(r, "fond").stack;
    const a = stack.addLayer("lightLeak");
    stack.updateParams(a, {
      origineX: 1, origineY: 0.32, direction: 195, portee: 0.62,
      largeur: 0.13, ouverture: 1.1, attenuation: 1.5,
      intensite: 1.35, chaleur: 0.55, irregularite: 0.38, echelleBruit: 5.5, graine: 0,
    });
    const L = stack.layers.find((l) => l.id === a); L.blendMode = "screen";
    const frame = await r.exportFrame(stack.layers);
    out.lightLeak = { img: versDataUrl(frame), stat: stat(frame) };
  }

  // Scene 2 : texture avec un scan de bibliotheque (mireEncre).
  {
    const cv = document.createElement("canvas"); cv.width = LW; cv.height = LH;
    const ctx = await initGpu(cv);
    const r = new Renderer(ctx, undefined, async () => mireEncre(512, 512), () => 0);
    await r.loadImage(photo);
    r.setTextureCatalog(["mire-encre-generee"]);
    await r.ensureTextureLoaded(0);
    const stack = openDocument(r, "fond").stack;
    const a = stack.addLayer("texture");
    stack.updateParams(a, {
      rang: 0, echelle: 0.35, rotation: 0, decalageX: 0, decalageY: 0,
      inversion: 0, desaturation: 0, contraste: 1, pivot: 0.5,
    });
    const frame = await r.exportFrame(stack.layers);
    out.texture = { img: versDataUrl(frame), stat: stat(frame) };
  }

  // Scene 3 : glow sur mireBokeh (pire cas lecteur d'image).
  {
    const bok = await mireBokeh(512, 512);
    const cv = document.createElement("canvas"); cv.width = 512; cv.height = 512;
    const ctx = await initGpu(cv);
    const r = new Renderer(ctx, undefined, undefined, () => 0);
    await r.loadImage(bok);
    const stack = openDocument(r, "fond").stack;
    const a = stack.addLayer("glow");
    stack.updateParams(a, { threshold: 0.3, knee: 0.3, intensity: 2.5, spread: 1.0, shadowHold: 0, shadowHoldPoint: 0.5 });
    const frame = await r.exportFrame(stack.layers);
    out.glow = { img: versDataUrl(frame), stat: stat(frame), crop: cropDataUrl(frame, 100, 260) };
  }

  return JSON.stringify(out);
})()`;

const res = JSON.parse(await evalIn(script, frameCtx.id));
const stats = {};
for (const [scene, o] of Object.entries(res)) {
  writeFileSync(path.join(OUT, `planche24-${PREFIXE}-${scene}.png`), Buffer.from(o.img.split(",")[1], "base64"));
  if (o.crop) writeFileSync(path.join(OUT, `planche24-${PREFIXE}-${scene}-crop.png`), Buffer.from(o.crop.split(",")[1], "base64"));
  stats[scene] = o.stat;
  console.log(`${PREFIXE} ${scene}: moyenne ${o.stat.moyenne} ecart-type ${o.stat.ecartType}`);
}
writeFileSync(path.join(OUT, `planche24-stats-${PREFIXE}.json`), JSON.stringify(stats, null, 2));
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
