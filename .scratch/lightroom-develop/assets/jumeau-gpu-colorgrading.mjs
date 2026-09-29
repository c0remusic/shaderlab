// LE SHADER REND-IL CE QUE DIT LE TWIN ? — contrôle GPU ↔ colorGradingSpec, pixel à pixel.
//
// test:render dit QUE le rendu a changé (les sept références developpement-grading-*
// après le passage au canal par canal en ProPhoto), pas QU'IL est juste. Ce script
// rend colorGrading par le vrai pipeline (iframe du harnais, module map vierge, donc
// le shader TEL QU'IL EST SUR LE DISQUE) sur une mire colorée, puis calcule le twin TS
// dans la même page sur les pixels d'entrée, et mesure l'écart en niveaux.
//
// Prérequis : app lancée avec CDP 9222 et Vite du dépôt sur 1421 (skill run-shaderlab).
// Usage : node jumeau-gpu-colorgrading.mjs
const ORIGIN = process.argv[2] ?? "http://localhost:1421";
const REGLAGES = {
  "ombres-bleu": { shadowHue: 220, shadowSat: 60 },
  "hl-orange": { highlightHue: 40, highlightSat: 60 },
  "balance": { shadowHue: 220, shadowSat: 60, highlightHue: 40, highlightSat: 60, balance: 100 },
  "fusion-0": { shadowHue: 220, shadowSat: 60, highlightHue: 40, highlightSat: 60, blending: 0 },
  "hl-lum": { highlightLum: 50 },
  "ombres-lum-m50": { shadowLum: -50 },
  "moyens-global-lum": { midtoneLum: 50, globalLum: 50 },
  "globale-bleu-sat100": { globalHue: 220, globalSat: 100, shadowLum: 40 },
};

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
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Runtime.enable");
const evalIn = async (expression, contextId) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId === undefined ? {} : { contextId }) });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};
const FRAME_ID = "__jumeauCgFrame";
const before = new Set(contexts.map((c) => c.uniqueId));
const loaded = await evalIn(`new Promise((res) => {
  document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
  const f = document.createElement("iframe");
  f.id = ${JSON.stringify(FRAME_ID)};
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok"); f.onerror = () => res("erreur");
  document.body.appendChild(f);
})`);
if (loaded !== "ok") throw new Error(`iframe: ${loaded}`);
await new Promise((r) => setTimeout(r, 400));
const ctx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));
if (!ctx) throw new Error("contexte iframe introuvable");

const res = JSON.parse(await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const { colorGradingSpec, colorGrading } = await import("/src/render/effects/colorGrading.ts");
  const { srgbToLinear, linearToSrgb } = await import("/src/render/effects/srgbTransfer.ts");
  const { hsl2rgb } = await import("/src/render/effects/hsl.ts");
  // Mire 256x256 : rampe grise, balayages de teinte a trois saturations et deux
  // luminances, blocs de primaires. Assez de couleurs pures pour faire sortir du
  // gamut sRGB une courbe restee dans [0,1] en ProPhoto.
  const W = 256, H = 256, d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bande = Math.floor(y / 32), fx = x / 255;
    let c;
    if (bande === 0) c = [fx, fx, fx];
    else if (bande === 1) c = hsl2rgb(fx, 1, 0.5);
    else if (bande === 2) c = hsl2rgb(fx, 0.5, 0.5);
    else if (bande === 3) c = hsl2rgb(fx, 1, 0.25);
    else if (bande === 4) c = hsl2rgb(fx, 1, 0.75);
    else if (bande === 5) c = hsl2rgb(fx, 0.25, 0.3);
    else if (bande === 6) c = hsl2rgb((Math.floor(fx * 6) / 6), 1, 0.2 + 0.6 * ((y % 32) / 31));
    else c = [fx, 1 - fx, (y % 32) / 31];
    const i = (y * W + x) * 4;
    d[i] = Math.round(c[0] * 255); d[i + 1] = Math.round(c[1] * 255); d[i + 2] = Math.round(c[2] * 255); d[i + 3] = 255;
  }
  const bmp = await createImageBitmap(new ImageData(d, W, H), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const r = new Renderer(await initGpu(cv), undefined, undefined, () => 0);
  await r.loadImage(bmp);
  const stack = openDocument(r, "fond").stack;
  // Le chemin d'EXPORT prend l'etage en PARAMETRE (exportFrame(layers, cadre, develop)) ;
  // setDevelop ne pose que celui de l'ecran — la premiere version de ce script etait
  // aveugle pour ca, et c'est la colonne « canaux qui bougent » qui l'a attrape.
  const base = (await r.exportFrame(stack.layers, null, {})).pixels;
  const defauts = colorGrading.params.map((p) => p.default);
  const sortie = {};
  for (const [nom, reg] of Object.entries(${JSON.stringify(REGLAGES)})) {
    const gpu = (await r.exportFrame(stack.layers, null, { colorGrading: reg })).pixels;
    const p = defauts.slice();
    for (const [k, v] of Object.entries(reg)) p[colorGrading.params.findIndex((q) => q.name === k)] = v;
    let max = 0, somme = 0, au1 = 0, n = 0, ouMax = -1;
    for (let i = 0; i < W * H; i++) {
      const lin = [0, 1, 2].map((c) => srgbToLinear(base[i * 4 + c] / 255));
      const tw = colorGradingSpec(lin, p).map((v) => linearToSrgb(Math.min(1, Math.max(0, v))) * 255);
      for (let c = 0; c < 3; c++) {
        const e = Math.abs(tw[c] - gpu[i * 4 + c]);
        somme += e; n++; if (e > 1) au1++;
        if (e > max) { max = e; ouMax = i; }
      }
    }
    // Ecart au rendu d'entree : le reglage doit AGIR, sinon le controle ne prouve rien.
    let bouge = 0;
    for (let i = 0; i < W * H * 4; i++) if (i % 4 !== 3 && Math.abs(gpu[i] - base[i]) > 1) bouge++;
    sortie[nom] = { max: +max.toFixed(2), moyenne: +(somme / n).toFixed(4), auDessusDe1: au1, bouge, ouMax };
  }
  r.dispose?.();
  return JSON.stringify(sortie);
})()`, ctx.id));

console.log("GPU contre twin colorGradingSpec, niveaux sRGB (mire 256x256, 3 canaux)");
console.log("reglage".padEnd(22) + "max".padStart(8) + "moyenne".padStart(10) + "  >1 LSB".padStart(10) + "  canaux qui bougent".padStart(22));
for (const [nom, v] of Object.entries(res)) {
  console.log(nom.padEnd(22) + String(v.max).padStart(8) + String(v.moyenne).padStart(10) + String(v.auDessusDe1).padStart(10) + String(v.bouge).padStart(22));
}
await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove(); "ok"`);
ws.close();
