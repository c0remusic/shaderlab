// Passe la MIRE DE PRESENCE dans NOTRE pipeline reel et demodule ses bandes
// exactement comme `analyse-mire-presence.py` demodule celles de Lightroom.
// C'est le pendant de `verifier-ton.mjs` pour les operateurs SPATIAUX : le twin
// CPU ne peut rien en dire, puisque la bande fine de Texture et la bande moyenne
// de Clarte n'existent que dans le shader.
//
// Le rendu passe par l'iframe du harnais (`render-check-page.html`), dont le
// module map est vierge : les modules servis sont ceux du DISQUE, edition non
// commitee comprise. Une variante de shader se mesure donc sans commit.
//
// Prerequis : l'app tourne avec le port CDP, et un Vite du worktree courant sur
// 1421. Usage : node mesure-presence-shaderlab.mjs [--cdp 9222]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ICI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORIGIN = "http://localhost:1421";
const portArg = process.argv.indexOf("--cdp");
const CDP = `http://localhost:${portArg > 0 ? process.argv[portArg + 1] : "9222"}`;

// La mire porte sa taille dans son nom (voir `faire-mire-presence.py`) : on prend
// la plus recente de largeur 2048 et on lit SA geometrie, jamais un nom ecrit en
// dur qui se perimerait a la premiere geometrie neuve.
const MIRES = readdirSync(path.join(ICI, "mire"))
  .filter((f) => /^shaderlab-mire-presence-2048x\d+\.jpg$/.test(f)).sort();
if (!MIRES.length) throw new Error("aucune mire de presence 2048 dans mire/ — lancer faire-mire-presence.py");
const MIRE = path.join(ICI, "mire", MIRES[MIRES.length - 1]);
const GEO = JSON.parse(readFileSync(MIRE.replace(/\.jpg$/, ".json"), "utf-8"));

// Memes doses que la campagne Lightroom (`campagne-presence.py`), memes noms :
// c'est ce qui permet au comparateur de les apparier sans table de correspondance.
const COLS = [
  { nom: "pres-temoin", params: {} },
  { nom: "pres-texture-p100", params: { texture: 100 } },
  { nom: "pres-texture-p50", params: { texture: 50 } },
  { nom: "pres-texture-m50", params: { texture: -50 } },
  { nom: "pres-texture-m100", params: { texture: -100 } },
  { nom: "pres-clarte-p100", params: { clarity: 100 } },
  { nom: "pres-clarte-p50", params: { clarity: 50 } },
  { nom: "pres-clarte-m50", params: { clarity: -50 } },
  { nom: "pres-clarte-m100", params: { clarity: -100 } },
  { nom: "pres-voile-p100", params: { dehaze: 100 } },
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
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, contextId });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
  return r.result?.result?.value;
};

const FRAME_ID = "__mirePresence";
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
const frameCtx = contexts.find((c) => !before.has(c.uniqueId) && (c.origin === ORIGIN || c.auxData?.type === "iframe"));
if (!frameCtx) throw new Error("contexte iframe introuvable");

const b64 = readFileSync(MIRE).toString("base64");
await evalIn(`window.__mireParts = []; "ok"`, frameCtx.id);
const CHUNK = 2_000_000;
for (let i = 0; i < b64.length; i += CHUNK) {
  await evalIn(`window.__mireParts.push(${JSON.stringify(b64.slice(i, i + CHUNK))}); "ok"`, frameCtx.id);
}
const setup = JSON.parse(await evalIn(`(async () => {
  const { initGpu } = await import("/src/render/gpuContext.ts");
  const { Renderer } = await import("/src/render/renderer.ts");
  const { openDocument } = await import("/src/layers/openedDocument.ts");
  const bin = atob(window.__mireParts.join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = await initGpu(cv);
  const r = new Renderer(ctx, undefined, undefined, () => 0);
  await r.loadImage(bmp);
  window.__mireSetup = { openDocument, r, W: bmp.width, H: bmp.height };
  return JSON.stringify({ W: bmp.width, H: bmp.height });
})()`, frameCtx.id));
if (setup.W !== GEO.largeur || setup.H !== GEO.hauteur) {
  throw new Error(`la mire chargee fait ${setup.W}x${setup.H}, la geometrie dit ${GEO.largeur}x${GEO.hauteur}`);
}

// La demodulation vit DANS la page : rapatrier les 36 Mo d'une frame par CDP
// pour n'en garder que 40 nombres serait le seul poste couteux de la mesure.
const mesure = async (col) => {
  const expr = `(async () => {
    const { openDocument, r } = window.__mireSetup;
    const params = ${JSON.stringify(col.params)};
    const develop = Object.keys(params).length ? { reglagesDeBase: params } : {};
    const stack = openDocument(r, "mire").stack;
    r.setDevelop(develop);
    const frame = await r.exportFrame(stack.layers, null, develop);
    const px = frame.pixels, W = frame.width;
    const geo = ${JSON.stringify(GEO)};
    const out = [];
    for (const b of geo.bandes) {
      const prof = new Float64Array(W);
      const n = b.y1 - b.y0;
      for (let y = b.y0; y < b.y1; y++) {
        let o = (y * W) * 4;
        for (let x = 0; x < W; x++, o += 4) {
          prof[x] += (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / n;
        }
      }
      let moy = 0;
      for (let x = 0; x < W; x++) moy += prof[x];
      moy /= W;
      const d = { zone: b.zone, cycles: b.cycles, periode: b.periode, base: b.base, amplitude: b.amplitude, moyenne: +moy.toFixed(4) };
      if (b.cycles < 0) {
        // Une marche rend son PROFIL brut, et rien de derive : le halo et sa
        // portee se calculent cote Python, une seule fois, par la fonction qui
        // sert deja aux exports de Lightroom. Deriver ici en ferait un jumeau
        // de plus a tenir.
        d.droite = b.droite;
        d.profil = Array.from(prof, (v) => +v.toFixed(3));
      } else if (b.cycles > 0) {
        let re1 = 0, im1 = 0, re2 = 0, im2 = 0;
        for (let x = 0; x < W; x++) {
          const ph = 2 * Math.PI * b.cycles * (x + 0.5) / W;
          re1 += prof[x] * Math.cos(ph); im1 -= prof[x] * Math.sin(ph);
          re2 += prof[x] * Math.cos(2 * ph); im2 -= prof[x] * Math.sin(2 * ph);
        }
        re1 = 2 * re1 / W; im1 = 2 * im1 / W; re2 = 2 * re2 / W; im2 = 2 * im2 / W;
        d.amp = +Math.hypot(re1, im1).toFixed(5);
        d.phase = +Math.atan2(im1, re1).toFixed(5);
        d.h2 = +Math.hypot(re2, im2).toFixed(5);
      } else {
        let s2 = 0;
        for (let x = 0; x < W; x++) s2 += (prof[x] - moy) * (prof[x] - moy);
        d.ecart_type = +Math.sqrt(s2 / W).toFixed(5);
      }
      out.push(d);
    }
    return JSON.stringify(out);
  })()`;
  return JSON.parse(await evalIn(expr, frameCtx.id));
};

const tout = {};
for (const col of COLS) {
  let bandes;
  for (let essai = 0; essai < 3; essai++) {
    try { bandes = await mesure(col); break; }
    catch (err) { if (essai === 2) throw err; await new Promise((r) => setTimeout(r, 4000)); }
  }
  tout[col.nom] = { nom: col.nom, largeur: setup.W, bandes };
  const e = bandes.find((b) => b.zone === "echelle" && Math.abs(b.periode - 16) < 0.5);
  const m = bandes.find((b) => b.zone === "echelle" && Math.abs(b.periode - 64) < 0.5);
  console.log(`${col.nom.padEnd(20)} amp(P=16)=${e.amp.toFixed(3)}  amp(P=64)=${m.amp.toFixed(3)}`);
}
writeFileSync(path.join(ICI, "presence-shaderlab.json"), JSON.stringify(tout, null, 1));
console.log("ecrit presence-shaderlab.json");
ws.close();
