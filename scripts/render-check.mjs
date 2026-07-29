// Verrouille le RENDU, pas la compilation : compare les pixels produits par
// le pipeline a des references versionnees.
//
// ─────────────────────────────────────────────────────────────────────────
// Le trou que ce script ferme
// ─────────────────────────────────────────────────────────────────────────
// `npm run test` verrouille des formules en TS sans jamais toucher un GPU.
// `npm run test:gpu-shaders` prouve que les 60+ shaders COMPILENT. Aucun des
// deux ne regarde une seule fois l'image PRODUITE : un changement de pipeline
// (ordre des passes, format d'une cible intermediaire, fond d'aplatissement,
// pre-multiplication) passe les 800+ tests, compile tous les shaders, et
// modifie l'image en silence. C'est exactement ce qui s'est produit a la
// tranche T0 (alpha compose + passe de presentation), mergee sans preuve de
// non-regression du rendu.
//
// ─────────────────────────────────────────────────────────────────────────
// Ce qu'on lit, et pourquoi PAS une capture d'ecran
// ─────────────────────────────────────────────────────────────────────────
// Une tentative anterieure a compare des `Page.captureScreenshot` du canvas
// avant/apres. Deux rejeux du MEME scenario sur le MEME code ont produit des
// PNG separes de 227 578 octets — plus de bruit que de signal. La cause n'est
// pas le pipeline (deterministe, mesure ci-dessous) : c'est que la capture
// d'ecran ne mesure PAS le rendu. Elle mesure la SURFACE DE PRESENTATION,
// qui empile trois choses etrangeres au rendu :
//
//  1. Un terme d'HORLOGE. Des qu'un overlay de masque est actif, la passe
//     d'overlay recoit `performance.now() / 1000`
//     (`render/framePipelineExecutor.ts:147`) et la boucle rAF la rejoue a
//     chaque frame (`render/renderer.ts:304`, `tickOverlayAnimation`). Le
//     canvas est alors une fonction du temps mural : deux captures a deux
//     instants ne peuvent pas etre egales. Mesure : voir le mode
//     `--diagnostic` (ecart non nul entre deux instants sur le MEME etat).
//  2. Une GEOMETRIE D'AFFICHAGE. Le canvas a la resolution NATIVE de l'image
//     (aucun downscale, decision projet) mais s'affiche reduit par CSS dans
//     l'espace laisse par la colonne de docks. Le `clip` d'une capture porte
//     sur ce rectangle de MISE EN PAGE : un panneau qui s'ouvre, une largeur
//     de dock restauree, et le rectangle change de taille — donc l'image
//     capturee change d'echelle, donc de contenu, sur des dizaines de
//     milliers de pixels. Rien de tout cela n'est du rendu.
//  3. Un ENCODEUR et un COMPOSITEUR. La capture revient en PNG deja encode,
//     apres un reechantillonnage par le compositeur.
//
// Ce harnais retire les trois d'un coup : il lit `Renderer.exportFrame()`,
// c'est-a-dire les OCTETS RGBA relus depuis la texture d'export
// (`render/frameReadback.ts`) — la meme sortie que celle qui part a l'export
// JPEG. Pas de canvas, pas de damier, pas de mise en page, pas d'encodeur,
// pas d'overlay (la passe d'overlay ne s'arme que si un id de calque lui est
// pose, ce que ce harnais ne fait jamais), et la resolution est celle de
// l'image source, fixee par le scenario.
//
// ─────────────────────────────────────────────────────────────────────────
// Ou tourne le code
// ─────────────────────────────────────────────────────────────────────────
// Meme technique que `gpu-shader-check.mjs` : la seule surface WebGPU reelle
// de ce projet est la fenetre WebView2. Le script s'y connecte en CDP et y
// evalue un script qui importe les modules du worktree depuis un Vite a part
// (`--origin`, defaut http://localhost:1421). Il construit son PROPRE
// `GPUDevice` et son PROPRE `Renderer` sur un canvas DETACHE : il ne lit ni
// ne modifie l'etat de l'application React affichee dans cette fenetre.
//
//   Terminal A :  npx vite --port 1421
//   Terminal B :  npm run test:render
//
// ─────────────────────────────────────────────────────────────────────────
// Auto-validation (la lecon de l'echec precedent)
// ─────────────────────────────────────────────────────────────────────────
// AVANT toute comparaison a une reference, chaque scenario est rendu DEUX
// FOIS, par deux `GPUDevice` distincts, deux `Renderer` distincts, deux
// chargements d'image distincts. Les deux passes doivent etre identiques
// OCTET POUR OCTET. Si elles ne le sont pas, le script s'arrete la, en echec,
// et ne rend AUCUN verdict de non-regression — un protocole instable ne peut
// pas rassurer sur quoi que ce soit.
//
// ─────────────────────────────────────────────────────────────────────────
// Tolerance
// ─────────────────────────────────────────────────────────────────────────
// La tolerance par defaut est ZERO : tout ecart non nul fait echouer. Ce n'est
// pas de la severite gratuite, c'est ce que la MESURE autorise — deux
// executions completes, sur deux `GPUDevice` distincts, rendent la meme image
// a l'octet pres, sur les six scenarios. Aucun ecart n'a jamais ete observe
// sur cette machine, donc aucun ecart n'a besoin d'etre pardonne.
//
// L'ecart d'arrondi d'un aller-retour `-srgb` (1 LSB par canal) existe bien en
// theorie, mais il ne se manifesterait qu'en changeant de GPU ou de pilote.
// Le harnais le CLASSE (`infra-lsb-epars` vs `rendu-modifie`, voir
// `scripts/lib/pixelDiff.mjs`) et chiffre l'ecart dans le rapport, mais il ne
// l'absout PAS tout seul : il faut `--tolerer-arrondi`, explicitement.
//
// Le temoin dit pourquoi. Decaler un poids de luminance d'un shader de 1e-4
// (0.2126 -> 0.2127 dans `render/effects/grain.ts`) deplace 100 canaux d'1 LSB,
// soit 0,038 % de l'image : EPARS et infra-LSB, donc dans la classe
// « compatible avec un arrondi ». Un seuil qui laisserait passer cette classe
// laisserait passer une vraie modification de rendu. C'est exactement le
// « harnais qui ne rougit sur rien » qu'il faut refuser.
//
// ─────────────────────────────────────────────────────────────────────────
// Usage
// ─────────────────────────────────────────────────────────────────────────
//   node scripts/render-check.mjs              compare aux references
//   node scripts/render-check.mjs --update     (re)ecrit les references
//   node scripts/render-check.mjs --diagnostic mesure la dependance du canvas
//                                              a l'horloge (overlay actif)
//   options : --port 9222  --origin http://localhost:1421  --scenario <id>
//             --tolerer-arrondi  accepte un ecart infra-LSB epars (arbitrage
//                                humain : changement de GPU/pilote, pas un defaut)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { encodePng, decodePng } from "./lib/png.mjs";
import { comparePixels, verdictFor } from "./lib/pixelDiff.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF_DIR = path.join(HERE, "..", "test", "render-refs");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(name);

const PORT = Number(flag("--port", "9222"));
const ORIGIN = flag("--origin", "http://localhost:1421");
const ONLY = flag("--scenario", null);
const UPDATE = has("--update");
const DIAGNOSTIC = has("--diagnostic");
const TOLERER_ARRONDI = has("--tolerer-arrondi");

/* ── CDP ────────────────────────────────────────────────────────────────── */

const FRAME_ID = "__renderCheckFrame";

async function connect(port, origin) {
  const targets = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page)
    throw new Error(
      `Aucune cible CDP sur le port ${port}. L'app doit tourner avec ` +
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.",
    );
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const contexts = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++id;
      pending.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Runtime.enable");

  const evalIn = async (expression, contextId) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      ...(contextId === undefined ? {} : { contextId }),
    });
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
    return r.result?.result?.value;
  };

  // Un iframe NEUF sur l'origine du Vite du worktree — voir l'en-tete de
  // `scripts/render-check-page.html` : c'est ce qui garantit un module map
  // vierge. Evaluer dans le document de l'app rendrait les modules `/src/**`
  // deja caches par la fenetre, donc une version du code potentiellement
  // perimee, sous un verdict vert. Piege verifie en pratique.
  const before = new Set(contexts.map((c) => c.uniqueId));
  const loaded = await evalIn(`new Promise((res) => {
    document.getElementById(${JSON.stringify(FRAME_ID)})?.remove();
    const f = document.createElement("iframe");
    f.id = ${JSON.stringify(FRAME_ID)};
    f.style.cssText = "position:fixed;left:-9999px;top:0;width:8px;height:8px;border:0";
    f.src = ${JSON.stringify(`${origin}/scripts/render-check-page.html`)};
    f.onload = () => res("ok");
    f.onerror = () => res("erreur de chargement");
    document.body.appendChild(f);
  })`);
  if (loaded !== "ok") throw new Error(`iframe ${origin}/scripts/render-check-page.html : ${loaded}`);
  // Le contexte d'execution est cree de facon asynchrone par rapport a `load`.
  let frame = null;
  for (let i = 0; i < 60 && !frame; i++) {
    frame = contexts.find((c) => c.origin === origin && !before.has(c.uniqueId)) ?? null;
    if (!frame) await new Promise((r) => setTimeout(r, 50));
  }
  if (!frame)
    throw new Error(
      `Aucun contexte d'execution sur ${origin}. Le Vite du worktree tourne-t-il ` +
        `(\`npx vite --port ${new URL(origin).port}\`) ?`,
    );

  return {
    /** Evalue DANS l'iframe (module map vierge), jamais dans le document de l'app. */
    evaluate: (expression) => evalIn(expression, frame.id),
    async close() {
      try {
        await evalIn(`document.getElementById(${JSON.stringify(FRAME_ID)})?.remove()`);
      } catch {
        /* la page a pu partir en vrille : ne pas masquer l'erreur d'origine */
      }
      ws.close();
    },
  };
}

/* ── Script injecte dans la page ────────────────────────────────────────── */

// Une seule installation, puis un appel par (scenario, passe) : garde chaque
// reponse CDP autour de 350 Ko plutot qu'un unique JSON de plusieurs Mo.
const INSTALL = `(async () => {
  const O = ${JSON.stringify(ORIGIN)};
  const { initGpu } = await import(O + "/src/render/gpuContext.ts");
  const { Renderer } = await import(O + "/src/render/renderer.ts");
  const { LayerStack } = await import(O + "/src/layers/layerStack.ts");

  const W = 256, H = 256;

  // Mire SYNTHETIQUE plutot qu'un JPEG de fixture : construite en arithmetique
  // entiere, elle est reproductible par definition (aucun decodeur JPEG, aucun
  // profil ICC, aucun rasteriseur 2D dans la boucle) et n'ajoute pas un binaire
  // au depot. Elle porte volontairement les quatre choses dont les effets ont
  // besoin : un degrade continu (quantification), un damier a aretes franches
  // (flou, warp, detection de contour), un disque en hautes lumieres (seuil du
  // glow) et des rayures fines (aliasing).
  const mire = (w, h, tint) => {
    const d = new Uint8ClampedArray(w * h * 4);
    const cx = (w >> 1), cy = (h >> 1), rr = (Math.min(w, h) * 0.23) | 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = ((x * 255) / (w - 1)) | 0;
      let g = ((y * 255) / (h - 1)) | 0;
      let b = (((x >> 4) ^ (y >> 4)) & 1) ? 224 : 32;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < rr * rr) { r = 250; g = 242; b = 208; }
      if (y > (h * 3) >> 2 && x < (w >> 2) && (x % 3) === 0) { r = 16; g = 16; b = 16; }
      d[i] = (r + tint) & 255; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  // Raster de pinceau DETERMINISTE : un disque a bord adouci, calcule, jamais
  // peint par un geste. Meme format que celui que produit MaskPainter (r8,
  // tightement pack, taille de l'image).
  const brushRaster = (w, h) => {
    const m = new Uint8Array(w * h);
    // Centre volontairement DECALE du disque en hautes lumieres de la mire :
    // un masque pose sur un aplat ne montrerait rien de ce que l'effet fait.
    const cx = w * 0.72, cy = h * 0.28, r = Math.min(w, h) * 0.3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      m[y * w + x] = d >= r ? 0 : Math.round(255 * (1 - (d / r) * (d / r)));
    }
    return m;
  };

  // Les ids de calque viennent d'un compteur de MODULE (\`freshId\`), qui ne
  // repart pas de zero entre deux appels : le module reste en cache dans cette
  // page. Deux passes du meme scenario auraient donc des ids differents. Ils ne
  // touchent aucun pixel (ils ne servent que de cle de cache de masque), mais
  // un etat qui derive entre deux passes n'a rien a faire dans un harnais qui
  // pretend prouver sa propre reproductibilite : on les normalise.
  const normalize = (stack) => {
    stack.layers.forEach((layer, i) => {
      const old = layer.id;
      layer.id = "L" + i;
      layer.mask = {
        ...layer.mask,
        sources: layer.mask.sources.map((s, j) => ({ ...s, id: "L" + i + "-s" + j })),
      };
      if (old === layer.id) return;
    });
    return stack.layers;
  };

  const scenarios = {
    // Document nu : court-circuit « 0 calque actif », copie stricte de la
    // source par la passe passthrough puis aplatissement.
    "base": async () => ({ layers: [] }),

    // Multi-passes (glow = 5 passes internes) + effet simple, avec opacite et
    // mode de fusion non triviaux.
    "effets-glow-posterize": async (r, stack) => {
      const a = stack.addLayer("glow");
      stack.updateParams(a, { threshold: 0.55, intensity: 1.6 });
      const b = stack.addLayer("posterize");
      stack.updateParams(b, { levels: 4 });
      stack.layers[0].opacity = 0.8;
      stack.layers[0].blendMode = "screen";
      stack.layers[1].opacity = 0.9;
      stack.layers[1].blendMode = "overlay";
      return {};
    },

    // Grain : le seul effet dont le nom evoque de l'aleatoire. Il n'en
    // contient pas — son bruit vient d'un \`hash()\` de la position, module par
    // un parametre \`seed\` EXPLICITE (render/effects/grain.ts). Fixer la graine
    // suffit ; il n'y a rien a exclure. Ce scenario est la pour le prouver.
    "grain-graine-fixe": async (r, stack) => {
      const a = stack.addLayer("grain");
      stack.updateParams(a, { intensity: 0.3, size: 3, seed: 7 });
      return {};
    },

    // Double exposure : une photo importee (autre source GPU, pre-passe
    // d'entree + transformation) sous un effet.
    "photo-double-exposure": async (r, stack) => {
      const photo = await mire(128, 96, 60);
      const sourceId = await r.photoSources.register(photo);
      const p = stack.addPhotoLayer(sourceId, { x: 150, y: 110, scale: 1.4, rotation: 0.35 }, "mire");
      stack.layers[0].opacity = 0.75;
      stack.layers[0].blendMode = "multiply";
      const c = stack.addLayer("chromaticBleed", p);
      stack.updateParams(c, { amount: 0.05, centerFalloff: 1.5 });
      return {};
    },

    // Masque : source pinceau (raster) + source parametrique (degrade)
    // combinees, plus le refine edge (adoucissement / contraction / lissage,
    // donc les passes de morphologie separees H/V).
    "masque-pinceau-degrade": async (r, stack) => {
      const a = stack.addLayer("warp");
      stack.updateParams(a, { scale: 4, amplitude: 0.08, octaves: 4, seed: 2 });
      stack.updateBrushMask(a, brushRaster(W, H));
      const g = stack.addMaskSource(a, "gradient");
      stack.updateMaskSourceParams(a, g, { angle: 0, startX: 0, startY: 0, endX: 1, endY: 1, feather: 0.8, invert: 0 });
      stack.setMaskSourceCombineMode(a, g, "intersect");
      stack.updateRefineEdge(a, { feather: 6, contract: -3, smooth: 2 });
      return {};
    },

    // Chaine edge-aware (guided filter + SAT) : une dizaine de passes WGSL qui
    // ne s'executent que si la case est cochee, et qui portent leur propre
    // cache invalide par epoque — exactement le genre de chemin ou une
    // regression dort longtemps.
    "masque-edge-aware": async (r, stack) => {
      const a = stack.addLayer("duotone");
      stack.updateBrushMask(a, brushRaster(W, H));
      stack.updateRefineEdge(a, { feather: 2, edgeAware: true, edgeRadius: 8, edgeStrength: 0.8 });
      return {};
    },
  };

  const b64 = (u8) => {
    let s = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    return btoa(s);
  };

  let pass = null;

  window.__renderCheck = {
    ids: Object.keys(scenarios),
    width: W,
    height: H,
    async openPass() {
      const cv = document.createElement("canvas");
      cv.width = 4; cv.height = 4;
      const ctx = await initGpu(cv);
      pass = { ctx, format: ctx.srgbFormat };
      return ctx.srgbFormat;
    },
    closePass() { pass = null; },
    async run(id) {
      const r = new Renderer(pass.ctx);
      try {
        await r.loadImage(await mire(W, H, 0));
        const stack = new LayerStack();
        await scenarios[id](r, stack);
        const layers = normalize(stack);
        const first = await r.exportFrame(layers);
        // Deuxieme lecture sur le MEME renderer : separe une instabilite de
        // frame (cache de pipeline, epoque de masque) d'une instabilite de
        // mise en place (device, upload de texture).
        const second = await r.exportFrame(layers);
        let intra = 0;
        for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) intra++;
        return JSON.stringify({ ok: true, intra, nLayers: layers.length, pixels: b64(first) });
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e && e.stack ? e.stack : e) });
      } finally {
        r.dispose();
      }
    },
    // Mesure la dependance a l'horloge de la surface de PRESENTATION — la
    // chose meme qu'une capture d'ecran mesure et que ce harnais refuse de
    // mesurer. Reconfigure un canvas detache en COPY_SRC pour pouvoir relire
    // ce que la passe de presentation y a ecrit, arme l'overlay de masque,
    // puis rend deux fois avec deux instants d'horloge differents.
    async diagnostic() {
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const ctx = await initGpu(cv);
      // initGpu configure sans COPY_SRC (le canvas de l'app n'est jamais relu).
      ctx.context.configure({
        device: ctx.device,
        format: ctx.canvasFormat,
        viewFormats: [ctx.srgbFormat],
        alphaMode: "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      const { FrameReadback } = await import(O + "/src/render/frameReadback.ts");
      const readCanvas = async () => {
        const rb = new FrameReadback(ctx.device, W, H, ctx.srgbFormat.startsWith("bgra"));
        return rb.stripRowPadding(await rb.readTextureBytes(ctx.context.getCurrentTexture()));
      };
      const r = new Renderer(ctx);
      await r.loadImage(await mire(W, H, 0));
      const stack = new LayerStack();
      const a = stack.addLayer("posterize");
      stack.updateBrushMask(a, brushRaster(W, H));
      const layers = normalize(stack);

      const wait = () => new Promise((res) => setTimeout(res, 120));

      // (1) OVERLAY ETEINT — ce que lit le harnais.
      r.setMaskOverlay(null);
      const exportA = await r.exportFrame(layers);
      await wait();
      const exportB = await r.exportFrame(layers);
      r.render(layers); const canvasA = await readCanvas();
      await wait();
      r.render(layers); const canvasB = await readCanvas();

      // (2) OVERLAY ARME — \`framePipelineExecutor.run\` injecte
      // performance.now() dans la passe d'overlay (framePipelineExecutor.ts:147).
      r.setMaskOverlay("L0");
      r.render(layers); const ovCanvasA = await readCanvas();
      await wait();
      r.render(layers); const ovCanvasB = await readCanvas();

      // (3) la boucle rAF rejoue la meme passe a un autre instant d'horloge.
      r.tickOverlayAnimation(1000); const tickA = await readCanvas();
      r.tickOverlayAnimation(1600); const tickB = await readCanvas();

      // (4) \`exportFrame\` passe par le MEME \`runPipeline\`, donc par le meme
      // \`maskOverlayLayerId\` : l'overlay ne s'arrete pas au canvas.
      const ovExportA = await r.exportFrame(layers);
      await wait();
      const ovExportB = await r.exportFrame(layers);

      const diff = (x, y) => { let n = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) n++; return n; };
      const out = {
        canaux: canvasA.length,
        "[overlay eteint] exportFrame, 2 instants": diff(exportA, exportB),
        "[overlay eteint] canvas, 2 instants": diff(canvasA, canvasB),
        "[overlay eteint] canvas vs exportFrame": diff(canvasA, exportA),
        "[overlay arme] canvas, 2 instants": diff(ovCanvasA, ovCanvasB),
        "[overlay arme] canvas, 2 ticks rAF": diff(tickA, tickB),
        "[overlay arme] exportFrame, 2 instants": diff(ovExportA, ovExportB),
        "[overlay arme vs eteint] exportFrame": diff(ovExportA, exportA),
      };
      r.dispose();
      return JSON.stringify(out);
    },
  };
  return JSON.stringify({ ids: Object.keys(scenarios), width: W, height: H });
})()`;

/* ── Deroule ────────────────────────────────────────────────────────────── */

function fail(message) {
  console.error("\nECHEC — " + message);
  process.exitCode = 1;
}

const cdp = await connect(PORT, ORIGIN);
try {
  await main(cdp);
} catch (e) {
  fail(String(e && e.stack ? e.stack : e));
} finally {
  // Toujours retirer l'iframe : le harnais ne laisse rien derriere lui dans la
  // fenetre de l'app. D'ou l'absence de `process.exit()` dans `main` — il
  // court-circuiterait ce nettoyage.
  await cdp.close();
}

async function main(cdp) {
  const meta = JSON.parse(await cdp.evaluate(INSTALL));
  const ids = ONLY ? meta.ids.filter((i) => i === ONLY) : meta.ids;
  if (ids.length === 0) throw new Error(`Scenario inconnu: ${ONLY} (connus: ${meta.ids.join(", ")})`);

  if (DIAGNOSTIC) {
    const d = JSON.parse(await cdp.evaluate("window.__renderCheck.diagnostic()"));
    console.log("Dependance a l'horloge de la surface de presentation (canaux divergents / " + d.canaux + ") :\n");
    for (const [k, v] of Object.entries(d)) if (k !== "canaux") console.log(`  ${String(v).padStart(8)}  ${k}`);
    return;
  }

  console.log(`Rendu ${meta.width}x${meta.height}, ${ids.length} scenario(s), 2 passes independantes.\n`);

  // Passe 1 et passe 2 : deux GPUDevice, deux Renderer, deux chargements.
  const passes = [];
  for (let p = 0; p < 2; p++) {
    const format = await cdp.evaluate("window.__renderCheck.openPass()");
    if (p === 0) console.log(`Format de texture : ${format}\n`);
    const results = {};
    for (const id of ids) {
      const raw = JSON.parse(await cdp.evaluate(`window.__renderCheck.run(${JSON.stringify(id)})`));
      if (!raw.ok) throw new Error(`scenario ${id} : ${raw.error}`);
      results[id] = { pixels: new Uint8Array(Buffer.from(raw.pixels, "base64")), intra: raw.intra, nLayers: raw.nLayers };
    }
    await cdp.evaluate("window.__renderCheck.closePass()");
    passes.push(results);
  }

  // ── Etape 1 : le harnais se valide LUI-MEME. Aucun verdict de
  // non-regression n'est rendu tant que le protocole n'a pas prouve qu'il se
  // repete a l'octet pres.
  let stable = true;
  console.log("Reproductibilite du protocole (passe 1 vs passe 2, octet pour octet) :");
  for (const id of ids) {
    const a = passes[0][id];
    const b = passes[1][id];
    const inter = comparePixels(a.pixels, b.pixels);
    const ok = inter.differing === 0 && a.intra === 0 && b.intra === 0;
    if (!ok) stable = false;
    console.log(
      `  ${ok ? "OK  " : "FAIL"}  ${id.padEnd(26)} ${a.nLayers} calque(s)` +
        `  intra-passe: ${a.intra}/${b.intra}  inter-passes: ${inter.differing} canaux` +
        (inter.differing ? ` (max ${inter.maxAbs})` : ""),
    );
  }
  if (!stable) {
    fail(
      "le protocole n'est PAS reproductible : deux executions du meme code ne rendent pas la meme image.\n" +
        "Aucune comparaison aux references n'a ete faite — un protocole instable ne peut rien garantir.",
    );
    return;
  }
  console.log("  -> protocole reproductible, la comparaison peut avoir un sens.\n");

  // ── Etape 2 : comparaison aux references.
  if (UPDATE) {
    mkdirSync(REF_DIR, { recursive: true });
    for (const id of ids) {
      const file = path.join(REF_DIR, `${id}.png`);
      const png = encodePng(passes[0][id].pixels, meta.width, meta.height);
      writeFileSync(file, png);
      console.log(`  ecrit  ${path.relative(process.cwd(), file)}  (${png.length} octets)`);
    }
    console.log("\nReferences mises a jour. Relire les images AVANT de les committer.");
    return;
  }

  let regressions = 0;
  let manquantes = 0;
  console.log("Non-regression (pixels vs reference versionnee) :");
  for (const id of ids) {
    const file = path.join(REF_DIR, `${id}.png`);
    if (!existsSync(file)) {
      manquantes++;
      console.log(`  ABSENT ${id.padEnd(26)} pas de reference — \`node scripts/render-check.mjs --update\``);
      continue;
    }
    const ref = decodePng(readFileSync(file));
    if (ref.width !== meta.width || ref.height !== meta.height) {
      regressions++;
      console.log(`  FAIL   ${id.padEnd(26)} dimensions ${ref.width}x${ref.height} vs ${meta.width}x${meta.height}`);
      continue;
    }
    const stats = comparePixels(passes[0][id].pixels, ref.pixels);
    const { verdict, raison } = verdictFor(stats);
    const accepte = verdict === "identique" || (verdict === "infra-lsb-epars" && TOLERER_ARRONDI);
    if (!accepte) regressions++;
    const tag = accepte ? (verdict === "identique" ? "OK    " : "TOLERE") : "FAIL  ";
    console.log(
      `  ${tag} ${id.padEnd(26)} ${raison}` +
        (stats.differing
          ? `  [max ${stats.maxAbs}, moyenne ${stats.meanAbs.toFixed(4)}, 1er pixel ${stats.firstIndex >> 2}]`
          : ""),
    );
  }

  if (manquantes) fail(`${manquantes} reference(s) manquante(s).`);
  else if (regressions)
    fail(
      `${regressions} scenario(s) dont le rendu a change.\n` +
        "Si l'ecart est infra-LSB et epars ET que la machine/le pilote a change depuis la reference,\n" +
        "`--tolerer-arrondi` l'accepte — mais c'est un arbitrage humain, pas un defaut.",
    );
  else console.log("\nAucune regression de rendu.");
}
