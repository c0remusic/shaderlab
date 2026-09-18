// LA PLANCHE QUI DECIDE LE 187x.
//
// Colonne A — rendre a la resolution NATIVE, puis reduire pour l'ecran. Ce que
//             l'app fait aujourd'hui : 16,9 ms de GPU, 1150 Mo de VRAM.
// Colonne B — rendre DIRECTEMENT a la resolution d'affichage. 0,09 ms, 160 Mo.
//
// Les deux images sortent a la MEME taille finale — celle a laquelle l'oeil les
// voit. C'est la seule comparaison honnete : la question n'est pas « laquelle
// est plus definie » mais « les distingue-t-on a l'ecran ».
//
// Deux scenes, parce que la reponse differe :
//   TONAL — exposition, contraste, clarte, texture, vibrance. Operateurs de ton.
//   GRAIN — l'effet PAR PIXEL, le cas qui a motive la decision d'origine.
//
// ⚠️ PHOTO D'ORIGINE BOITIER UNIQUEMENT (regle du depot) : un export deja
// developpe ferait juger nos operateurs par-dessus un developpement etranger.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SORTIE = "C:/Users/LEETJ/AppData/Local/Temp/claude/C--dev-shaderlab/5cd8e3ee-e6ce-40b9-9de5-528e15ea775a/scratchpad/opti";
const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";

const PHOTO = "C:/Users/LEETJ/Pictures/2018/2018-01-25/DSCF5171.JPG";

// Taille d'affichage REELLE, mesuree sur cette fenetre dock ouvert.
const AFFICHE_W = 456;
const AFFICHE_H = 304;

// Detourage 1:1 a la taille d'affichage : un effet par pixel ne se juge pas
// reduit (lecon de la planche du verre).
const CROP = 300;

// Trois scenes, choisies pour separer GLOBAL et LOCAL — pas « ton » et « pixel ».
// Un operateur dont le rayon s'exprime en PIXELS change de sens avec la
// resolution, qu'il touche le ton ou la matiere.
const SCENES = {
  // Aucun rayon : gain, pente, chroma. Tout se calcule pixel par pixel sans
  // regarder les voisins.
  global: { develop: { reglagesDeBase: { exposure: 0.4, contrast: 35, vibrance: 30, saturation: 15 } }, effet: null },
  // Texture et Clarte portent un rayon en pixels — memes valeurs, deux echelles
  // spatiales differentes.
  local: { develop: { reglagesDeBase: { exposure: 0.4, contrast: 35, clarity: 55, texture: 40, vibrance: 30 } }, effet: null },
  // L'effet par pixel, le cas qui a motive la decision d'origine.
  grain: { develop: {}, effet: "grain" },
};

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
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, contextId });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const FRAME_ID = "__plancheResolution";
const before = new Set(contexts.map((c) => c.uniqueId));
await evalIn(`new Promise((res) => {
  document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
  const f = document.createElement("iframe");
  f.id = ${JSON.stringify(FRAME_ID)};
  f.style.cssText = "position:absolute;left:-9999px;width:16px;height:16px";
  f.src = ${JSON.stringify(`${ORIGIN}/scripts/render-check-page.html`)};
  f.onload = () => res("ok");
  document.body.appendChild(f);
})`);
await new Promise((r) => setTimeout(r, 400));
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));
if (!frameCtx) throw new Error("contexte iframe introuvable");

const b64 = readFileSync(PHOTO).toString("base64");
await evalIn(`window.__parts = []; "ok"`, frameCtx.id);
for (let i = 0; i < b64.length; i += 2_000_000) {
  await evalIn(`window.__parts.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); "ok"`, frameCtx.id);
}

// Un seul GPUDevice pour toute la planche ; un Renderer par resolution.
const init = JSON.parse(await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__parts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes]);
  const plein = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = plein.width; cv.height = plein.height;
  const ctx = await initGpu(cv);
  window.__pl = { ctx, Renderer, openDocument, blob, plein };
  return JSON.stringify({ W: plein.width, H: plein.height });
})()`, frameCtx.id));
console.log("photo " + init.W + " x " + init.H + " = " + (init.W * init.H / 1e6).toFixed(1) + " Mpx");

// Colonne B rend a la resolution d'AFFICHAGE : la source est reduite d'abord,
// exactement ce que ferait un apercu a resolution d'ecran.
const facteur = AFFICHE_W / init.W;
const reduitW = AFFICHE_W;
const reduitH = Math.round(init.H * facteur);
console.log("colonne B : source reduite a " + reduitW + " x " + reduitH);

for (const [nomScene, scene] of Object.entries(SCENES)) {
  for (const [colonne, pleineResolution] of [["A-natif", true], ["B-affichage", false]]) {
    const res = JSON.parse(await evalIn(`(async () => {
      const { ctx, Renderer, openDocument, blob } = window.__pl;
      const pleine = ${pleineResolution};
      const bmp = pleine
        ? await createImageBitmap(blob, { imageOrientation: "from-image" })
        : await createImageBitmap(blob, { imageOrientation: "from-image", resizeWidth: ${reduitW}, resizeHeight: ${reduitH}, resizeQuality: "high" });
      const r = new Renderer(ctx, undefined, undefined, () => 0);
      await r.loadImage(bmp);
      const doc = openDocument(r, "photo");
      const stack = doc.stack;
      const effet = ${JSON.stringify(scene.effet)};
      if (effet) stack.addLayer(effet);
      const develop = ${JSON.stringify(scene.develop)};
      r.setDevelop(develop);
      const frame = await r.exportFrame(stack.layers, null, develop);

      const full = document.createElement("canvas");
      full.width = frame.width; full.height = frame.height;
      full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);

      // Reduction a la taille d'AFFICHAGE. Pour la colonne A c'est le travail
      // que fait le compositeur aujourd'hui ; pour la colonne B c'est presque
      // l'identite (la source est deja a cette taille).
      const vue = document.createElement("canvas");
      vue.width = ${AFFICHE_W}; vue.height = ${AFFICHE_H};
      const g = vue.getContext("2d");
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      const echelle = Math.max(${AFFICHE_W} / frame.width, ${AFFICHE_H} / frame.height);
      const dw = frame.width * echelle, dh = frame.height * echelle;
      g.drawImage(full, (${AFFICHE_W} - dw) / 2, (${AFFICHE_H} - dh) / 2, dw, dh);

      // Detourage 1:1 DANS LA VUE : ce que l'oeil voit, agrandi sans rien
      // reinterpoler cote source.
      const crop = document.createElement("canvas");
      crop.width = ${CROP}; crop.height = ${CROP};
      crop.getContext("2d").imageSmoothingEnabled = false;
      crop.getContext("2d").drawImage(vue, (${AFFICHE_W} - ${CROP}) / 2, (${AFFICHE_H} - ${CROP}) / 2, ${CROP}, ${CROP}, 0, 0, ${CROP}, ${CROP});

      return JSON.stringify({ vue: vue.toDataURL("image/png"), crop: crop.toDataURL("image/png"), fw: frame.width, fh: frame.height });
    })()`, frameCtx.id));
    writeFileSync(path.join(SORTIE, `res-${nomScene}-${colonne}-vue.png`), Buffer.from(res.vue.split(",")[1], "base64"));
    writeFileSync(path.join(SORTIE, `res-${nomScene}-${colonne}-crop.png`), Buffer.from(res.crop.split(",")[1], "base64"));
    console.log("  " + nomScene + " / " + colonne + " : rendu " + res.fw + "x" + res.fh);
  }
}
ws.close();
