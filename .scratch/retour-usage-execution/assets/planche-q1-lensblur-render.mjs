// Planche Q1 — lensBlur : montrer que le bokeh ne se lit que sur des points
// lumineux, et que les reglages agissent LA. Rend six variantes sur DEUX scenes.
//
// OU TOURNE LE CODE. Iframe sur render-check-page.html (module map VIERGE) :
// modules servis depuis le DISQUE, aucun IPC, aucune ecriture app. Meme technique
// que mesure-25-lensblur.mjs / planche-24-render.mjs.
//
// SCENES.
//  - "grille"  : mireBokeh de render-check.mjs (4x4 points isoles, teintes/rayons
//                varies) — la mire canonique du dossier pour cet effet.
//  - "nuit"    : scene synthetique nuit urbaine — fond sombre, points brillants
//                dissemines (blancs satures + teintes chaudes/froides), blocs de
//                ton moyen (immeubles) qui, eux, ne font que flouter. Un point
//                blanc HERO isole sert au crop 1:1.
//
// CROPS 1:1 sur un point brillant : une tache de bokeh est un phenomene PAR
// POINT ; reduite, elle redevient du flou. Vignettes reduites en plus.
//
// Aucun accent ni backtick dans le code injecte dans la page.
import { writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";

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

const FRAME_ID = "__plancheQ1Frame";
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

// Base : les defauts reels du module lensBlur (lus dans src/render/effects/lensBlur.ts).
const BASE = {
  radius: 24, blades: 0, bladeRotation: 0,
  highlightThreshold: 0.6, highlightBoost: 6,
  fieldShape: 0, fieldCenterX: 0.5, fieldCenterY: 0.5,
  fieldAngle: 0, fieldRange: 0.35, fieldFeather: 0.5, bladeCurvature: 0,
};

// Six variantes du brief. Rayon 24 partout.
const VARIANTES = [
  { id: "defaut",        params: {} },
  { id: "blades6",       params: { blades: 6 } },
  { id: "blades6-rot30", params: { blades: 6, bladeRotation: 30 } },
  { id: "blades6-curv",  params: { blades: 6, bladeCurvature: 0.6 } },
  { id: "boost0",        params: { highlightBoost: 0 } },
  { id: "boost6",        params: { highlightBoost: 6 } },
  { id: "iris",          params: { fieldShape: 2, fieldRange: 0.3 } },
];

const script = `(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");

  // mireBokeh : copie fidele de scripts/render-check.mjs (4x4 points isoles).
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
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rr * rr) continue;
          const i = (y * w + x) * 4;
          d[i] = row === 0 || row === 3 ? 255 : 90;
          d[i + 1] = row === 1 || row === 3 ? 255 : 90;
          d[i + 2] = row === 2 || row === 3 ? 255 : 90;
        }
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  // nuit urbaine : fond sombre, blocs de ton moyen (immeubles), points brillants
  // varies, un point blanc HERO isole pour le crop.
  const mireNuit = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < d.length; i += 4) { d[i] = 14; d[i + 1] = 14; d[i + 2] = 18; d[i + 3] = 255; }
    // Immeubles : blocs de ton moyen, bas de l image.
    const blocs = [[40, 250, 90, 110, 78], [180, 270, 70, 90, 96], [300, 240, 120, 120, 62], [460, 265, 80, 95, 88]];
    for (const [bx, by, bw, bh, v] of blocs)
      for (let y = by; y < Math.min(h, by + bh); y++)
        for (let x = bx; x < Math.min(w, bx + bw); x++) {
          const i = (y * w + x) * 4; d[i] = v; d[i + 1] = v; d[i + 2] = Math.min(255, v + 10);
        }
    const poser = (cx, cy, rr, t) => {
      for (let y = Math.floor(cy - rr); y <= cy + rr; y++)
        for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rr * rr) continue;
          const i = (y * w + x) * 4; d[i] = t[0]; d[i + 1] = t[1]; d[i + 2] = t[2];
        }
    };
    // Point HERO blanc sature, tres isole (grande marge sombre autour).
    poser(150, 110, 2, [255, 255, 255]);
    // Autres lumieres : blanches saturees, chaudes, froides, plus quelques mates.
    const pts = [
      [90, 60, 1, [255, 255, 255]], [250, 70, 2, [255, 210, 150]], [330, 55, 1, [150, 200, 255]],
      [420, 95, 2, [255, 255, 255]], [500, 60, 1, [255, 235, 200]], [70, 175, 1, [180, 220, 255]],
      [230, 150, 2, [255, 255, 255]], [390, 165, 1, [255, 190, 120]], [470, 185, 2, [255, 255, 255]],
      // fenetres eclairees dans les immeubles : petites mais brillantes
      [210, 300, 1, [255, 240, 190]], [330, 285, 1, [255, 230, 170]], [350, 320, 1, [200, 220, 255]],
      [490, 300, 1, [255, 245, 210]],
    ];
    for (const [x, y, r, t] of pts) poser(x, y, r, t);
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  const versDataUrl = (frame) => {
    const c = document.createElement("canvas"); c.width = frame.width; c.height = frame.height;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
    return c.toDataURL("image/png");
  };
  // Crop CARRE centre (cx,cy), cote S, pixels 1:1.
  const cropDataUrl = (frame, cx, cy, S) => {
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
    for (let i = 0; i < p.length; i += 4) {
      const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; s += l; s2 += l * l;
    }
    const m = s / n; return { moyenne: +m.toFixed(2), ecartType: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(2) };
  };

  const BASE = ${JSON.stringify(BASE)};
  const VARIANTES = ${JSON.stringify(VARIANTES)};

  // Une scene = {nom, W, H, faire(), hero:[cx,cy], crop:S}.
  const SCENES = [
    { nom: "grille", W: 512, H: 512, faire: mireBokeh, hero: [320, 448], crop: 128 },
    { nom: "nuit",   W: 560, H: 360, faire: mireNuit,  hero: [150, 110], crop: 128 },
  ];

  const out = {};
  for (const sc of SCENES) {
    const mire = await sc.faire(sc.W, sc.H);
    const cv = document.createElement("canvas"); cv.width = sc.W; cv.height = sc.H;
    const ctx = await initGpu(cv);
    const renderer = new Renderer(ctx, undefined, undefined, () => 0);
    await renderer.loadImage(mire);
    out[sc.nom] = {};
    for (const v of VARIANTES) {
      const stack = openDocument(renderer, "fond").stack;
      const lid = stack.addLayer("lensBlur");
      stack.updateParams(lid, { ...BASE, ...v.params });
      const frame = await renderer.exportFrame(stack.layers);
      out[sc.nom][v.id] = {
        img: versDataUrl(frame),
        crop: cropDataUrl(frame, sc.hero[0], sc.hero[1], sc.crop),
        stat: stat(frame),
      };
    }
  }
  return JSON.stringify(out);
})()`;

const res = JSON.parse(await evalIn(script, frameCtx.id));
const manifest = {};
for (const [scene, vars] of Object.entries(res)) {
  manifest[scene] = {};
  for (const [vid, o] of Object.entries(vars)) {
    writeFileSync(path.join(OUT, `q1-${scene}-${vid}.png`), Buffer.from(o.img.split(",")[1], "base64"));
    writeFileSync(path.join(OUT, `q1-${scene}-${vid}-crop.png`), Buffer.from(o.crop.split(",")[1], "base64"));
    manifest[scene][vid] = o.stat;
    console.log(`${scene} ${vid.padEnd(14)} moyenne ${String(o.stat.moyenne).padStart(6)}  ecart-type ${String(o.stat.ecartType).padStart(6)}`);
  }
}
writeFileSync(path.join(OUT, "q1-manifest.json"), JSON.stringify(manifest, null, 2));
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
console.log("\nplanche Q1 : PNG + q1-manifest.json ecrits");
