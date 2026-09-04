// Planche 24 — VOIE A : deformer la SORTIE (rasteriser le composite puis l'etirer).
// Zero edition moteur. Pour chaque scene on rend DEUX composites par le pipeline
// reel : E (avec effet) et S (sans effet). Puis en JS, re-echantillonnage affine
// bilineaire de E autour du centre ; la ou le quad transforme ne couvre plus le
// cadre, on affiche S. Les trois etats (identite, scaleX 2, scaleY 0.4) sont
// produits en un seul run. Aucun accent ni backtick dans le code evalue.
// Usage : node planche-24-voieA.mjs
// Ecrit planche24-A-<etat>-<scene>.png (+ -crop pour glow) et planche24-stats-A.json
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

const FRAME_ID = "__planche24AFrame";
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

  const toU8 = (frame) => ({ w: frame.width, h: frame.height, p: new Uint8ClampedArray(frame.pixels) });
  const versDataUrl = (im) => {
    const c = document.createElement("canvas");
    c.width = im.w; c.height = im.h;
    c.getContext("2d").putImageData(new ImageData(im.p, im.w, im.h), 0, 0);
    return c.toDataURL("image/png");
  };
  const cropDataUrl = (im, y0, y1) => {
    const hc = y1 - y0;
    const sub = new Uint8ClampedArray(im.w * hc * 4);
    sub.set(im.p.subarray(y0 * im.w * 4, y1 * im.w * 4));
    const c = document.createElement("canvas");
    c.width = im.w; c.height = hc;
    c.getContext("2d").putImageData(new ImageData(sub, im.w, hc), 0, 0);
    return c.toDataURL("image/png");
  };
  const stat = (im) => {
    const p = im.p; let s = 0, s2 = 0, n = im.w * im.h;
    for (let i = 0; i < p.length; i += 4) {
      const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      s += l; s2 += l * l;
    }
    const m = s / n; return { moyenne: +m.toFixed(2), ecartType: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(2) };
  };

  // Re-echantillonnage affine autour du centre. sx,sy = facteurs AVANT (etirement
  // de la sortie). Pixel de destination -> source(E) par la carte inverse ; hors
  // du cadre de E on affiche S (le fond non affecte). Bilineaire sur E.
  const echantillonner = (im, fx, fy) => {
    const w = im.w, h = im.h, p = im.p;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const cl = (v, hi) => v < 0 ? 0 : (v > hi ? hi : v);
    const x1 = cl(x0 + 1, w - 1), y1 = cl(y0 + 1, h - 1);
    const xa = cl(x0, w - 1), ya = cl(y0, h - 1);
    const out = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const a = p[(ya * w + xa) * 4 + k], b = p[(ya * w + x1) * 4 + k];
      const c = p[(y1 * w + xa) * 4 + k], dd = p[(y1 * w + x1) * 4 + k];
      out[k] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + dd * tx) * ty;
    }
    return out;
  };
  const deformer = (E, S, sx, sy) => {
    const w = E.w, h = E.h;
    const o = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w, v = (y + 0.5) / h;
      const su = (u - 0.5) / sx + 0.5, sv = (v - 0.5) / sy + 0.5;
      const idx = (y * w + x) * 4;
      if (su >= 0 && su < 1 && sv >= 0 && sv < 1) {
        const c = echantillonner(E, su * w - 0.5, sv * h - 0.5);
        o[idx] = c[0]; o[idx + 1] = c[1]; o[idx + 2] = c[2]; o[idx + 3] = c[3];
      } else {
        o[idx] = S.p[idx]; o[idx + 1] = S.p[idx + 1]; o[idx + 2] = S.p[idx + 2]; o[idx + 3] = S.p[idx + 3];
      }
    }
    return { w, h, p: o };
  };

  // Rend E (avec effet) et S (sans effet) pour une scene.
  const rendre = async (loadBitmap, decode, poser) => {
    const cv = document.createElement("canvas");
    const bm = await loadBitmap();
    cv.width = bm.width; cv.height = bm.height;
    const ctx = await initGpu(cv);
    const r = decode ? new Renderer(ctx, undefined, decode, () => 0) : new Renderer(ctx, undefined, undefined, () => 0);
    await r.loadImage(bm);
    if (decode) { r.setTextureCatalog(["mire-encre-generee"]); await r.ensureTextureLoaded(0); }
    const sStack = openDocument(r, "fond").stack;
    const S = toU8(await r.exportFrame(sStack.layers));
    const eStack = openDocument(r, "fond").stack;
    await poser(r, eStack);
    const E = toU8(await r.exportFrame(eStack.layers));
    return { E, S };
  };

  const etats = [["identite", 1, 1], ["scaleX2", 2, 1], ["scaleY04", 1, 0.4]];
  const out = {};

  // Scene 1 : lightLeak.
  {
    const { E, S } = await rendre(
      async () => photo, null,
      async (r, stack) => {
        const a = stack.addLayer("lightLeak");
        stack.updateParams(a, {
          origineX: 1, origineY: 0.32, direction: 195, portee: 0.62,
          largeur: 0.13, ouverture: 1.1, attenuation: 1.5,
          intensite: 1.35, chaleur: 0.55, irregularite: 0.38, echelleBruit: 5.5, graine: 0,
        });
        stack.layers.find((l) => l.id === a).blendMode = "screen";
      });
    out.lightLeak = {};
    for (const [nom, sx, sy] of etats) {
      const im = deformer(E, S, sx, sy);
      out.lightLeak[nom] = { img: versDataUrl(im), stat: stat(im) };
    }
  }

  // Scene 2 : texture.
  {
    const { E, S } = await rendre(
      async () => photo, async () => mireEncre(512, 512),
      async (r, stack) => {
        const a = stack.addLayer("texture");
        stack.updateParams(a, {
          rang: 0, echelle: 0.35, rotation: 0, decalageX: 0, decalageY: 0,
          inversion: 0, desaturation: 0, contraste: 1, pivot: 0.5,
        });
      });
    out.texture = {};
    for (const [nom, sx, sy] of etats) {
      const im = deformer(E, S, sx, sy);
      out.texture[nom] = { img: versDataUrl(im), stat: stat(im) };
    }
  }

  // Scene 3 : glow sur mireBokeh.
  {
    const { E, S } = await rendre(
      async () => mireBokeh(512, 512), null,
      async (r, stack) => {
        const a = stack.addLayer("glow");
        stack.updateParams(a, { threshold: 0.3, knee: 0.3, intensity: 2.5, spread: 1.0, shadowHold: 0, shadowHoldPoint: 0.5 });
      });
    out.glow = {};
    for (const [nom, sx, sy] of etats) {
      const im = deformer(E, S, sx, sy);
      out.glow[nom] = { img: versDataUrl(im), stat: stat(im), crop: cropDataUrl(im, 100, 260) };
    }
  }

  return JSON.stringify(out);
})()`;

const res = JSON.parse(await evalIn(script, frameCtx.id));
const stats = {};
for (const [scene, etats] of Object.entries(res)) {
  stats[scene] = {};
  for (const [etat, o] of Object.entries(etats)) {
    writeFileSync(path.join(OUT, `planche24-A-${etat}-${scene}.png`), Buffer.from(o.img.split(",")[1], "base64"));
    if (o.crop) writeFileSync(path.join(OUT, `planche24-A-${etat}-${scene}-crop.png`), Buffer.from(o.crop.split(",")[1], "base64"));
    stats[scene][etat] = o.stat;
    console.log(`A ${scene} ${etat}: moyenne ${o.stat.moyenne} ecart-type ${o.stat.ecartType}`);
  }
}
writeFileSync(path.join(OUT, "planche24-stats-A.json"), JSON.stringify(stats, null, 2));
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
