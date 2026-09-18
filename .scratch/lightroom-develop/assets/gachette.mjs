// NORMALISATION DE LA GACHETTE DE CLARTE.
//
// research/12 donne la FORME en ton (parabole a dose positive, levee uniforme a
// dose negative) mais pas comment le gain varie quand le DETAIL de l'image
// change. Trois images donnent trois niveaux de detail, et Lightroom a deja
// rendu son deplacement d'aplat sur les trois :
//
//   bi-tonale  : aucun detail nulle part    -> LR deplace  -0,185  (~zero)
//   portail    : detail sur une moitie      -> LR deplace -11,71
//   presence   : reseaux partout            -> LR deplace -19,59
//
// Il manque NOTRE canal de detail au meme endroit, avec le meme instrument. Ce
// script le lit sur les trois, dans les zones d'aplat que l'analyse de Lightroom
// a utilisees pour ses champs `loin_*`.
//
// Pieges respectes (research/09) : module pris dans le REGISTRE (jamais un
// import() nu), detour sur le RETOUR FINAL (jamais anticipe), et un TEMOIN qui
// renvoie `color` — s'il ne rend pas l'image, aucune colonne ne mesure rien.
// Les passes profondes sont ajoutees DANS LA PAGE : aucun fichier n'est touche.
import { readFileSync } from "node:fs";

const ORIGIN = "http://localhost:1421";
const CDP = "http://localhost:9222";
const MIRES = "C:/dev/shaderlab/.scratch/lightroom-develop/assets/mire/";
const ANCRE = "  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);";

// Chaque cas : l'image, et les bandes d'aplat ou Lightroom a mesure son champ
// lointain. `lr` est SON deplacement a Clarte +100, deja au disque.
const CAS = [
  {
    nom: "bitonale",
    fichier: "shaderlab-mire-bitonale-2048x8000.jpg",
    zones: [
      { nom: "aplat 96 (loin)", base: 96, y0: 200, y1: 3400, lr: -0.185 },
      { nom: "aplat 160 (loin)", base: 160, y0: 4600, y1: 7800, lr: 0.0 },
    ],
  },
  {
    nom: "portail",
    fichier: "shaderlab-mire-portee-2048x16384.jpg",
    // La zone PORTAIL occupe y 8192..16384 : aplat 128 en haut, reseau 128 en bas.
    zones: [
      { nom: "aplat 128 (loin)", base: 128, y0: 8400, y1: 11400, lr: -11.707 },
      { nom: "reseau 128 (loin)", base: 128, y0: 13200, y1: 16100, lr: -8.141 },
    ],
  },
  {
    nom: "presence",
    fichier: "shaderlab-mire-presence-2048x7584.jpg",
    zones: [
      { nom: "aplat 32", base: 32, y0: 3584, y1: 3632, lr: -2.66 },
      { nom: "aplat 128", base: 128, y0: 3888, y1: 3936, lr: -19.59 },
      { nom: "aplat 224", base: 224, y0: 4192, y1: 4240, lr: 2.68 },
    ],
  },
];

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
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

const FRAME_ID = "__gachette";
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
const ctxFrame = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));

const resultats = [];
for (const cas of CAS) {
  const b64 = readFileSync(MIRES + cas.fichier).toString("base64");
  await evalIn(`window.__parts = []; "ok"`, ctxFrame.id);
  for (let i = 0; i < b64.length; i += 2_000_000) {
    await evalIn(`window.__parts.push(${JSON.stringify(b64.slice(i, i + 2_000_000))}); "ok"`, ctxFrame.id);
  }

  const res = JSON.parse(await evalIn(`(async () => {
    const { initGpu } = await import("/src/render/gpuContext.ts");
    const { Renderer } = await import("/src/render/renderer.ts");
    const { openDocument } = await import("/src/layers/openedDocument.ts");
    const { developApplyOrder } = await import("/src/render/developRegistry.ts");
    const mod = developApplyOrder.find((m) => m.id === "reglagesDeBase");
    const bin = atob(window.__parts.join(""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
    const cv = document.createElement("canvas");
    cv.width = bmp.width; cv.height = bmp.height;
    const ctx = window.__gpu ?? (window.__gpu = await initGpu(cv));
    const r = new Renderer(ctx, undefined, undefined, () => 0);
    await r.loadImage(bmp);

    const passesOrigine = mod.passes.slice();
    const bas = passesOrigine[1].wgsl;
    const haut = passesOrigine[4].wgsl;
    const utile = passesOrigine[0].enabled;
    // FOND A 1/2048 : le balayage de profondeur.mjs montre que la moitie PLATE
    // du portail ne remonte vers la moitie detaillee qu'a cette profondeur-la
    // (0,15 octet a 1/128, 29,95 a 1/2048, pour 50 du cote detaille). La gachette
    // de Lightroom couvre la dimension de l'image, pas un rayon.
    // (aucun backtick ici : ce bloc vit DANS un template literal)
    const FOND = 1 / 2048;
    const profondes = [];
    for (let s = 0.25; s >= FOND - 1e-12; s /= 2) profondes.push({ scale: s, wgsl: bas, enabled: utile });
    for (let s = FOND * 2; s <= 0.0625 + 1e-12; s *= 2) profondes.push({ scale: s, wgsl: haut, enabled: utile });
    mod.passes = passesOrigine.concat(profondes);
    const origine = mod.wgsl;

    const develop = { reglagesDeBase: { clarity: 60 } };
    const stack = openDocument(r, "photo").stack;
    r.setDevelop(develop);

    const rendre = async (expr) => {
      mod.wgsl = origine.replace(${JSON.stringify(ANCRE)}, "  return " + expr + ";");
      const f = await r.exportFrame(stack.layers, null, develop);
      const W = f.width, px = f.pixels;
      const x0 = Math.round(W * 0.3), x1 = Math.round(W * 0.7);
      return ${JSON.stringify(cas.zones)}.map((z) => {
        let s = 0, n = 0;
        for (let y = z.y0; y < z.y1; y++) for (let x = x0; x < x1; x++) { s += px[(y * W + x) * 4]; n++; }
        return s / n;
      });
    };

    const detail = await rendre("vec4<f32>(vec3<f32>(textureSample(prevPass, srcSampler, uv).b), 1.0)");
    const temoin = await rendre("color");
    mod.wgsl = origine;
    mod.passes = passesOrigine;
    return JSON.stringify({ W: bmp.width, H: bmp.height, detail, temoin });
  })()`, ctxFrame.id));
  resultats.push({ cas, res });
  console.log(cas.nom + " " + res.W + "x" + res.H + " — temoin " + res.temoin.map((v) => v.toFixed(1)).join(" / "));
}

function s2l(c) { const x = Math.max(c, 0); return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }

console.log("");
console.log("cas        zone                 temoin   detail(octet)  detail(valeur)   LR dep.   log2(gain)   log2/(s(1-s))");
for (const { cas, res } of resultats) {
  cas.zones.forEach((z, i) => {
    const s0 = z.base / 255;
    const g = s2l((z.base + z.lr) / 255) / s2l(s0);
    const lg = Math.log2(g);
    const forme = s0 * (1 - s0);
    console.log(
      cas.nom.padEnd(10) + z.nom.padEnd(20) +
      res.temoin[i].toFixed(1).padStart(8) +
      res.detail[i].toFixed(2).padStart(14) +
      s2l(res.detail[i] / 255).toFixed(5).padStart(16) +
      z.lr.toFixed(2).padStart(10) +
      lg.toFixed(4).padStart(13) +
      (lg / forme).toFixed(3).padStart(15));
  });
}
ws.close();
