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
// Un scenario peut aussi declarer `surface: "canvas"` : il relit alors la
// SURFACE DE PRESENTATION, par la meme lecture GPU->CPU (`FrameReadback`) et
// jamais par une capture d'ecran — donc sans encodeur, sans compositeur et
// sans mise en page. Les trois termes de bruit ci-dessus disparaissent tous
// les trois : la geometrie est fixee (canvas detache, dimensions du document),
// l'horloge n'entre en jeu que si l'overlay est arme (aucun scenario ne
// l'arme), et il n'y a plus d'encodage. C'est ce qui rend le DAMIER
// verrouillable — le damier n'existe que sur cette surface
// (`presentBackgroundFor`), aucun scenario d'export ne peut le voir.
//
// ─────────────────────────────────────────────────────────────────────────
// Ce qu'un scenario doit poser lui-meme (tranche T1)
// ─────────────────────────────────────────────────────────────────────────
// Depuis la tranche T2, `Renderer.loadImage()` prend un SECOND argument
// optionnel : les dimensions de la toile. Omis, elles valent celles du bitmap —
// le chemin d'avant T2. Un scenario declare `toile` pour s'en ecarter.
//
// La toile n'est PLUS la photo. `Renderer.loadImage()` alloue une toile vide
// et enregistre la photo comme SOURCE ; c'est `App.tsx` qui en fait le calque
// du bas. Un scenario qui se contente d'un `new LayerStack()` nu rend donc du
// NOIR — c'est arrive, six references sur six sont devenues fausses en une
// tranche. Chaque scenario pose maintenant ce calque de fond comme
// l'application le fait (`fond: false` pour les deux qui veulent la toile
// vide, et qui sont la exactement pour ca).
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
// `--origin` N'EST PAS UN CONFORT. Le Vite interroge doit servir LE worktree
// dont on veut le verdict, et avoir demarre APRES les modifications a
// verifier. Un Vite d'une session voisine, ou celui de l'app sur 1420, rend un
// vert sur le code de quelqu'un d'autre — deux agents s'y sont fait prendre le
// 2026-07-29, dont un qui a annonce une non-regression fausse. La parade est
// mecanique et coute une minute : planter un temoin visible dans un shader,
// verifier que le harnais ROUGIT, le retirer, verifier qu'il redevient vert.
// Sans ce temoin, aucun verdict de ce script ne vaut.
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
// Deuxieme etage, ajoute le 2026-07-29 : la GATE DE SIGNAL (`verifierSignal`).
// La reproductibilite ne dit rien de la sensibilite — une image noire se
// repete parfaitement. Chaque scenario doit donc aussi montrer ce qu'il
// pretend montrer avant qu'une reference soit comparee OU ecrite. Voir le
// commentaire de cette fonction pour ce qui a rendu cette etape necessaire.
//
// ─────────────────────────────────────────────────────────────────────────
// Tolerance
// ─────────────────────────────────────────────────────────────────────────
// La tolerance par defaut est ZERO : tout ecart non nul fait echouer. Ce n'est
// pas de la severite gratuite, c'est ce que la MESURE autorise — deux
// executions completes, sur deux `GPUDevice` distincts, rendent la meme image
// a l'octet pres, sur les neuf scenarios. Aucun ecart n'a jamais ete observe
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
  const { FrameReadback } = await import(O + "/src/render/frameReadback.ts");
  // LE MEME CHEMIN QUE \`App.tsx\`, pas une copie (reserve R4 du 2026-07-30).
  // Avant, ce harnais REIMPLEMENTAIT l'ouverture — \`new LayerStack()\` +
  // \`addPhotoLayer(bg, resetTransform(toile))\` sous un commentaire « ce que fait
  // App.tsx ». Deux copies dont une seule etait exercee : rebrancher
  // \`bitmap.width\` a la place de \`canvasSize\` dans \`App.tsx\` ne faisait rougir
  // personne. \`openDocument\` prend le RENDERER, donc ni App ni ce harnais ne
  // peut choisir de quoi le calque de fond herite ses dimensions — et un temoin
  // plante dans ce module fait maintenant rougir le harnais.
  const { openDocument } = await import(O + "/src/layers/openedDocument.ts");

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

  // Mire A BOKEH : des points lumineux ISOLES sur du noir, de quatre tailles.
  //
  // La mire principale ne peut pas temoigner du bokeh, et ce n'est pas un
  // detail : une tache de bokeh ne se lit que sur un PETIT point brillant
  // contre du sombre. Un damier et un grand disque creme donnent, sous un lens
  // blur, exactement ce que donnerait un gaussien — donc un verrou pose dessus
  // ne saurait pas distinguer les deux.
  //
  // Les quatre tailles (1, 2, 3, 5 px de rayon) sont la pour verifier la
  // propriete que la reference cite comme signature de l'objectif : quand un
  // point lumineux retrecit, sa tache NE RETRECIT PAS — elle devient plus
  // transparente et ses bords plus nets. Quatre colonnes de taches de meme
  // diametre et d'intensites decroissantes, c'est ce qu'on doit voir.
  const mireBokeh = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < d.length; i += 4) d[i] = 255; // opaque, RGB reste a 0
    const rayons = [1, 2, 3, 5];
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        const cx = ((col + 0.5) * w) / 4, cy = ((row + 0.5) * h) / 4;
        const rr = rayons[col];
        for (let y = Math.floor(cy - rr); y <= cy + rr; y++) {
          for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            if ((x - cx) ** 2 + (y - cy) ** 2 > rr * rr) continue;
            const i = (y * w + x) * 4;
            // Teintes differentes par ligne : une tache de bokeh doit garder la
            // COULEUR de son point, pas la moyenner avec ses voisines.
            d[i] = row === 0 || row === 3 ? 255 : 90;
            d[i + 1] = row === 1 || row === 3 ? 255 : 90;
            d[i + 2] = row === 2 || row === 3 ? 255 : 90;
          }
        }
      }
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  // Mire A RAMPE : un degrade de gris NEUTRE, du noir au blanc, horizontal.
  //
  // La mire principale ne peut pas temoigner d'un effet dont le sujet est la
  // REPONSE TONALE : sa luminance saute d'un texel a l'autre a cause du damier,
  // donc une progression continue y devient illisible. Une rampe montre d'un
  // coup d'oeil ce qu'un hachurage pretend faire — les couches qui se relaient
  // l'une apres l'autre a mesure que le ton descend, et une gamme continue
  // obtenue avec une encre unique.
  //
  // Neutre (r = g = b) A DESSEIN : une rampe coloree ferait varier la luminance
  // ET la chromaticite en meme temps, et on ne saurait plus laquelle des deux
  // pilote la trame.
  const mireRampe = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = ((x * 255) / (w - 1)) | 0;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  // Mire A BARRES : barres verticales BINAIRES, periode 32 px (16 sombres, 16
  // claires), sur toute la toile et uniformes en y.
  //
  // Elle repond a une question qu AUCUNE autre mire ne peut trancher : un effet
  // qui deplace une lecture melange-t-il des COORDONNEES ou des COULEURS ? La
  // difference est structurelle et pas quantitative — un melange de coordonnees
  // ressort TOUJOURS une valeur de la source, un melange de couleurs FABRIQUE
  // des valeurs intermediaires partout ou les deux copies different.
  //
  // Deux proprietes rendent cette mesure incorruptible, et les deux ont ete
  // payees par une mesure ratee sur la mire commune (contraste -25 % qui ne
  // prouvait rien) :
  //  - BINAIRE : l interieur des barres n a que deux valeurs, donc toute valeur
  //    intermediaire est FABRIQUEE et se compte. Un contraste, lui, baisse aussi
  //    par interpolation bilineaire des decalages fractionnaires — il ne
  //    distingue pas les deux implementations.
  //  - UNIFORME EN Y ET SUR TOUTE LA LARGEUR : deux lignes de decalages
  //    differents echantillonnent un contenu statistiquement identique. Sur la
  //    mire commune, les rayures fines n occupent qu un quart de l image et un
  //    decalage de 30 px fait sortir certaines lignes de la zone — le contenu
  //    change, pas le melange.
  //
  // Barres LARGES (16 px) a dessein : le decalage entre deux tranches voisines
  // se compte en dizaines de pixels, donc les deux copies d un melange de
  // couleurs tomberaient en desaccord sur une grande part de la largeur.
  const mireBarres = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = ((x >> 4) & 1) ? 224 : 32;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  // Mire A BRUIT : deux aplats separes par un contour FRANC, chacun couvert
  // d un bruit de faible amplitude.
  //
  // Un filtre bilateral promet DEUX choses en meme temps — le bruit disparait,
  // le contour survit — et aucune mire existante ne porte les deux. Le damier
  // n a que des contours (rien a lisser), le degrade n a que des aplats (rien a
  // preserver) : sur l un comme sur l autre, un bilateral et un gaussien
  // rendraient la meme chose, et la reference ne prouverait rien.
  //
  // Amplitude du bruit choisie SOUS le seuil d ecart du scenario, marche entre
  // les aplats choisie tres au-dessus : c est ce rapport qui rend le resultat
  // lisible. Bruit deterministe (generateur congruentiel a graine fixe), comme
  // tout ce qui entre dans une reference.
  const mireBruit = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    let graine = 12345;
    const suivant = () => {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      return graine / 0x7fffffff;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Marche verticale au tiers, et une seconde horizontale a mi-hauteur :
        // deux orientations de contour, donc un biais d orientation du filtre
        // se verrait.
        let base = x < w / 3 ? 0.30 : 0.62;
        if (y > h / 2) base = base + 0.14;
        const v = Math.round(Math.min(1, Math.max(0, base + (suivant() - 0.5) * 0.06)) * 255);
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
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

  /** Acces a un calque par l'id rendu par \`addLayer\`/\`addPhotoLayer\`, jamais
   *  par indice : depuis que chaque scenario commence par un calque photo de
   *  fond, \`layers[0]\` n'est plus le calque que le scenario vient de creer. */
  const at = (stack, id) => {
    const layer = stack.layers.find((l) => l.id === id);
    if (!layer) throw new Error("calque introuvable: " + id);
    return layer;
  };

  // Chaque scenario est un OBJET, plus une fonction : deux axes n'existaient
  // pas avant la tranche T1.
  //  - \`fond\` (defaut true) : le scenario pose-t-il le calque photo de fond,
  //    comme \`App.tsx\` a l'ouverture d'un document ? Depuis T1 la toile est
  //    allouee, effacee en alpha 0 et JAMAIS uploadee — un scenario sans ce
  //    calque ne rend pas la mire, il rend le vide. Les cinq scenarios d'effet
  //    l'ont appris a leurs depens : leurs references d'avant T1 verrouillaient
  //    la mire, le rendu d'apres T1 sortait une image noire uniforme.
  //  - \`surface\` (defaut "export") : \`exportFrame()\` (octets du fichier) ou
  //    "canvas" (surface de presentation, damier compris). Le damier n'existe
  //    QUE sur le canvas (\`presentBackgroundFor\`) : aucun scenario d'export ne
  //    peut le voir, donc aucun ne peut le verrouiller.
  //  - \`toile\` (defaut W x H, c'est-a-dire exactement la taille de la mire) :
  //    dimensions du DOCUMENT, ajoute par la tranche T2. Jusque-la tous les
  //    scenarios posaient toile == photo, si bien que rien ne verrouillait le
  //    seul cas que T2 introduit — une toile dont les dimensions ne sont celles
  //    d'aucune photo. Une reference n'a donc plus la meme taille que les
  //    autres : les dimensions voyagent avec chaque resultat (voir \`run\`).
  const scenarios = {
    // LA TOILE, VIDE, DANS UN FICHIER. Zero calque : c'est le court-circuit
    // « 0 calque active » de \`framePipelineExecutor\` (copie neutre) puis
    // l'aplatissement d'un alpha 0 sur le fond d'EXPORT. Attendu : noir
    // opaque. Ce scenario est l'heritier direct de l'ancien « base » — meme
    // chemin de code exactement, mais « 0 calque » ne veut plus dire « la
    // photo telle quelle », il veut dire « rien ». Il verrouille surtout ce
    // qu'un JPEG ne pardonne pas : l'alpha sortant vaut 1 partout.
    "toile-vide": { fond: false, valeurs: 1, build: async () => {} },

    // LA MEME TOILE VIDE, A L'ECRAN. Le damier — le seul rendu que T1 a rendu
    // observable et que rien ne verrouillait. Le facteur d'echelle
    // d'affichage reste a son defaut (1), donc une case fait
    // \`CHECKER_CELL_SCREEN_PX\` pixels de destination.
    "toile-damier": { fond: false, surface: "canvas", valeurs: 2, build: async () => {} },

    // LE DOCUMENT TEL QUE L'APPLICATION L'OUVRE : la photo est un calque
    // ordinaire pose sur la toile (T1). Couvre la pre-passe photo, la
    // couverture de calque, le compositing d'un seul calque et
    // l'aplatissement. C'est l'autre moitie de l'ancien « base » : ce que
    // « document nu » designe depuis T1.
    "photo-de-fond-seule": { build: async () => {} },

    // LA TOILE N'EST PLUS LA TAILLE DE LA PHOTO (tranche T2). Toile carree
    // 320 x 320, mire 256 x 256 : la photo est centree, a l'echelle 1, et une
    // bande de 32 px reste non couverte sur les quatre cotes. Dans le FICHIER
    // exporte cette bande est BLANCHE (ADR-0006, arbitrage du 2026-07-30) ; a
    // l'ecran ce serait le damier, que ce scenario ne peut pas voir puisqu'il
    // lit \`exportFrame\`.
    //
    // C'est le seul scenario qui verrouille ce que T2 introduit. Ce qu'il
    // attrape et qu'aucun autre ne pouvait attraper : une dimension d'export
    // reprise d'une autre source que la toile, une pre-passe photo qui ne
    // realloue pas sa cible sur un changement de dimensions, une transform
    // d'ouverture centree sur la photo au lieu de la toile, et le fond d'export
    // lui-meme.
    //
    // Pas de \`contre\` : la comparaison d'ecart suppose deux images de MEME
    // taille. Son signal est celui de la mire (des milliers de valeurs), plus
    // le blanc du passe-partout.
    "toile-plus-grande-que-la-photo": {
      toile: { width: 320, height: 320 },
      build: async () => {},
    },

    // Multi-passes (glow = 5 passes internes) + effet simple, avec opacite et
    // mode de fusion non triviaux.
    "effets-glow-posterize": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("glow");
        stack.updateParams(a, { threshold: 0.55, intensity: 1.6 });
        const b = stack.addLayer("posterize");
        stack.updateParams(b, { levels: 4 });
        at(stack, a).opacity = 0.8;
        at(stack, a).blendMode = "screen";
        at(stack, b).opacity = 0.9;
        at(stack, b).blendMode = "overlay";
      },
    },

    // Grain : le seul effet dont le nom evoque de l'aleatoire. Il n'en
    // contient pas — son bruit vient d'un \`hash()\` de la position, module par
    // un parametre \`seed\` EXPLICITE (render/effects/grain.ts). Fixer la graine
    // suffit ; il n'y a rien a exclure. Ce scenario est la pour le prouver.
    "grain-graine-fixe": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("grain");
        stack.updateParams(a, { intensity: 0.3, size: 3, seed: 7 });
      },
    },

    // Double exposure : une photo importee (autre source GPU, pre-passe
    // d'entree + transformation) sous un effet.
    "photo-double-exposure": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const photo = await mire(128, 96, 60);
        const sourceId = await r.photoSources.register(photo);
        // scaleX/scaleY et non scale : le champ unique a ete remplace par DEUX
        // axes le 2026-07-31 (LayerTransform, src/layers/types.ts). Ce fixture
        // a garde "scale: 1.4" pendant un jour — un champ que plus personne ne
        // lit, donc un scenario qui declarait un agrandissement de 40 % et n'en
        // rendait aucun. Ce fichier est en .mjs ET ce bloc vit dans un template
        // literal envoye a la page : TypeScript ne pouvait pas le dire, et un
        // backtick dans un commentaire d'ici casse le parsing du script entier.
        // C'est la chute d'entropie du PNG de reference (40 Ko -> 15 Ko) qui a
        // trahi le champ mort. Toute evolution de LayerTransform doit repasser
        // ici A LA MAIN.
        const p = stack.addPhotoLayer(sourceId, { x: 150, y: 110, scaleX: 1.4, scaleY: 1.4, rotation: 0.35 }, "mire");
        at(stack, p).opacity = 0.75;
        at(stack, p).blendMode = "multiply";
        const c = stack.addLayer("chromaticBleed", p);
        stack.updateParams(c, { amount: 0.05, centerFalloff: 1.5 });
      },
    },

    // Lens blur : le seul effet dont la sortie depend d'une COLLECTE sur une
    // ouverture (48 taps en spirale d'angle d'or, tournee par un tirage par
    // pixel) et d'une geometrie de champ lue par DEUX passes a des resolutions
    // differentes. Les deux endroits ou une regression serait la plus sournoise
    // sont couverts ici et nulle part ailleurs : un desaccord entre les deux
    // lectures du champ (frange au raccord net/flou) et une derive du tirage
    // par pixel (le grain du bokeh change sans que rien d'autre ne bouge).
    // Iris + 6 lames : la geometrie de champ ET la forme du diaphragme sont
    // toutes deux hors de leur valeur neutre, donc toutes deux verrouillees.
    "effet-lens-blur": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("lensBlur");
        stack.updateParams(a, {
          radius: 28,
          blades: 6,
          bladeRotation: 15,
          highlightThreshold: 0.5,
          highlightBoost: 8,
          fieldShape: 2,
          fieldCenterX: 0.42,
          fieldCenterY: 0.55,
          fieldRange: 0.3,
          fieldFeather: 0.4,
        });
      },
    },

    // Lens blur, TEMOIN DE BOKEH : points lumineux isoles sur du noir, quatre
    // tailles. C'est le seul scenario qui puisse distinguer ce flou d'un
    // gaussien — champ Uniforme (donc pas de zone nette qui masquerait le
    // resultat), diaphragme a 6 lames, pas de flou de champ pour brouiller la
    // lecture. Ce qu'on doit voir : quatre colonnes d'hexagones de MEME
    // diametre, d'intensite decroissante de droite a gauche.
    "effet-lens-blur-bokeh": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "points");
        const a = stack.addLayer("lensBlur", p);
        stack.updateParams(a, {
          radius: 22,
          blades: 6,
          bladeRotation: 0,
          highlightThreshold: 0.35,
          highlightBoost: 14,
          fieldShape: 0,
        });
      },
    },

    // Hatching, TEMOIN DE PROGRESSION TONALE : une rampe de gris neutre du noir
    // au blanc. C'est le seul scenario capable de montrer ce que cet effet
    // pretend faire — trois couches de tailles qui se relaient quand la
    // precedente sature, donc une gamme continue avec une encre unique. Sur la
    // mire commune, le damier ferait sauter la luminance d'un texel a l'autre
    // et la progression serait illisible.
    //
    // Delave du fond a 0 : la photo reste sous la trame. A 0.75 (le defaut) le
    // fond est delave et la reference ne verrouillerait plus que le trace, pas
    // son rapport au ton.
    "effet-hatching": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("hatching", p);
        stack.updateParams(a, {
          angle: 45, spacing: 9, weight: 0.62, crossAngle: 65, layers: 3,
          blackPoint: 0.05, whitePoint: 0.95, wash: 0,
        });
      },
    },

    // Outlines, pose AVANT l extraction du gradient de Scharr vers un module
    // partage (2026-08-01). Cet effet n avait aucun verrou de pixels : sa
    // sortie depend d un noyau 3x3 sur huit taps, d une mesure de chromaticite
    // et d un plancher fwidth, et rien n aurait vu une derive de l un des
    // trois. Le scenario existe donc d abord pour rendre l extraction PROUVABLE
    // — il reste ensuite comme verrou permanent.
    //
    // Sensibilite couleur a 0.8 : la mire porte des damiers colores de meme
    // luminance, donc le second gradient (celui de la chromaticite) est
    // reellement sollicite. A 0 il ne le serait pas et la moitie de l effet
    // sortirait du verrou.
    "effet-outlines": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("outlines");
        stack.updateParams(a, {
          thickness: 2.5, threshold: 0.09, softness: 0.35, chroma: 0.8,
          inkHue: 210, inkSaturation: 0.2, inkLightness: 0.06, wash: 0.35,
          inputSource: 0,
        });
      },
    },

    // Colored edges, TEMOIN D ORIENTATION. La mire commune suffit ici, et c est
    // rare assez pour etre dit : son disque en hautes lumieres est un contour
    // FERME, donc il parcourt tout le cercle des orientations, donc toute la
    // roue chromatique. Un damier seul n aurait montre que deux teintes (les
    // bords y sont a 0 et 90 degres) et n aurait rien prouve.
    //
    // Delave a 0.85 : les contours dominent. C est la teinte qu on verrouille
    // ici, pas le rapport a la photo.
    "effet-colored-edges": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("coloredEdges");
        stack.updateParams(a, {
          thickness: 2, threshold: 0.07, softness: 0.3, chroma: 0.5,
          hueOffset: 0, hueSpread: 1, saturation: 0.85, lightness: 0.55,
          wash: 0.85, inputSource: 0,
        });
      },
    },

    // Motion blur, TEMOIN DE TRAJECTOIRE. Mode ROTATION et non Directionnel :
    // c est le seul des trois dont une propriete se VERIFIE d un coup d oeil —
    // la longueur de trainee est proportionnelle au rayon, donc le centre reste
    // net sans qu aucun reglage ne le demande. Un file directionnel, lui, rend
    // la meme chose partout et une reference posee dessus ne distinguerait pas
    // un motion blur d un flou quelconque etire.
    //
    // Decentrage a 0.6 : l obturateur est franchement asymetrique, donc la
    // trainee part d un seul cote et le bord net du sujet entre aussi dans le
    // verrou.
    "effet-motion-blur": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("motionBlur");
        stack.updateParams(a, {
          trajectory: 1, amount: 18, angle: 0,
          centerX: 0.5, centerY: 0.5, bias: 0.6, falloff: 0.35,
        });
      },
    },

    // Surface blur, TEMOIN DE PRESERVATION. Seuil d ecart a 0.09 : au-dessus de
    // l amplitude du bruit de la mire, tres en dessous des marches entre
    // aplats. Ce qu on doit voir : les quatre aplats devenus lisses, et les
    // deux contours — un vertical, un horizontal — aussi francs qu avant.
    // C est la seule configuration ou un bilateral et un gaussien ne rendent
    // PAS la meme chose.
    "effet-surface-blur": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const bruit = await mireBruit(W, H);
        const sourceId = await r.photoSources.register(bruit);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bruit");
        const a = stack.addLayer("surfaceBlur", p);
        stack.updateParams(a, { radius: 20, threshold: 0.09, stiffness: 0.45 });
      },
    },

    // Pixel stretch, avec une REGION. Antoine a releve que notre effet ne rendait
    // pas celui de Figma ; la comparaison sur image a montre pourquoi — le notre
    // etait GLOBAL et mangeait la photo en bandes, le leur se place sur la toile
    // (« place the on-canvas circle over the area you want to stretch »).
    //
    // Le scenario est donc pose sur le cas qui compte : etirement horizontal
    // franc (force 1) mais borne a un disque, avec l asymetrie a fond pour que
    // la coulure ne parte que d un cote. Ce qu on doit voir : une coulure qui
    // sort du disque, et la mire INTACTE tout autour. Un rayon au maximum
    // redonnerait l ancien comportement, donc c est bien la region qu on
    // verrouille ici et pas seulement l etirement.
    "effet-pixel-stretch": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("pixelStretch");
        stack.updateParams(a, {
          angle: 0, position: 0.42, reach: 1.2, strength: 1,
          wobble: 0.15, wobbleScale: 7, smooth: 0.2, offset: 0.9,
          regionRadius: 0.34, regionX: 0.5, regionY: 0.5, regionFeather: 0.45,
        });
      },
    },

    // Warp, TYPE ANALYTIQUE. Le scenario masque-pinceau-degrade couvre deja le
    // chemin du BRUIT fractal ; celui-ci couvre l autre famille, ajoutee le
    // 2026-08-01 d apres la fiche Figma. Tourbillon plutot qu un autre des huit :
    // c est celui dont la propriete se verifie d un coup d oeil — la
    // decroissance est gaussienne, donc la spirale mord fort au centre et
    // s attenue vers les bords SANS jamais poser de cercle visible a sa limite.
    // Mesure a l appui, et contre l intuition : elle ne s annule pas non plus —
    // a scale=3 le facteur vaut encore ~0.23 dans les coins, et ils tournent.
    // Une gaussienne n a pas de bord ; c est ce qui evite la marque, et c est
    // aussi ce qui interdit d annoncer des coins intacts.
    "effet-warp-tourbillon": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("warp");
        stack.updateParams(a, {
          type: 8, scale: 3, amplitude: 0.12, octaves: 3, roughness: 0.5,
          anisotropy: 0, twist: 0, seed: 0, centerX: 0.5, centerY: 0.5,
        });
      },
    },

    // Halftone, TEMOIN DE ROSETTE. C est la seule propriete qui distingue une
    // vraie trame d une grille de points, et elle n apparait qu en CMJN : les
    // quatre encres sont tramees a 15, 75, 0 et 45 degres, et ce sont ces
    // ecarts qui font la petite fleur de points de l offset. Trame au meme
    // angle partout = moire, pas rosette.
    //
    // Pas de trame a 10 px sur une toile de 256 : assez gros pour que la
    // rosette se lise, assez fin pour que la gamme se voie. La mire commune
    // convient — ses aplats colores de ton moyen sont exactement l endroit ou
    // les quatre encres se superposent.
    "effet-halftone": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("halftone");
        stack.updateParams(a, {
          dotSize: 10, dotScale: 1.05, colorMode: 0, rotation: 0,
          centerX: 0.5, centerY: 0.5, softness: 0.12, blackPoint: 0, whitePoint: 1,
        });
      },
    },

    // Anamorphic streak, sur la mire a POINTS LUMINEUX ISOLES — la meme que le
    // temoin de bokeh, et pour une raison voisine : une trainee ne se lit que
    // sur une source ponctuelle contre du sombre. Sur un damier, l etalement
    // directionnel se confondrait avec un flou de mouvement.
    //
    // Ce qu on doit voir : des traits HORIZONTAUX bleus partant de chaque
    // point, de longueur egale quelle que soit la taille du point (c est une
    // lumiere parasite, pas un flou), et de la MEME couleur pour les quatre
    // teintes de la mire — la trainee prend sa teinte du traitement de l
    // objectif, pas de la source.
    "effet-anamorphic-streak": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "points");
        const a = stack.addLayer("anamorphicStreak", p);
        stack.updateParams(a, {
          threshold: 0.5, length: 70, intensity: 1.4, angle: 0,
          tintHue: 210, tintSaturation: 0.8, tintLightness: 0.6, dispersion: 0.25,
        });
      },
    },

    // Slice shift, TEMOIN DE COUPURE — pose le 2026-08-02 AVANT d ajouter le
    // fondu des bords demande par Antoine, pour la meme raison qu outlines :
    // cet effet n avait aucun verrou, et « le defaut a 0 ne change rien »
    // resterait une affirmation sans une reference d avant le geste.
    //
    // Sur la RAMPE, pas sur la mire commune, et c est le point qui decide de
    // tout : la propriete a montrer est la MARCHE de valeur a la frontiere
    // entre une tranche decalee et sa voisine. Un damier saute deja d un texel
    // a l autre — la marche s y noierait dans les sauts du motif, exactement le
    // piege paye par lensBlur. Une rampe neutre monte continument en x : un
    // decalage horizontal y devient un DECALAGE DE VALEUR pur, et la frontiere
    // se lit comme une marche franche en scannant une colonne.
    //
    // angle 0 : \`along\` = x (glissement horizontal, donc le long de la rampe),
    // \`normal\` = y (bandes horizontales). Tranches de 32 px sur 256 = huit
    // bandes, assez pour que l irregularite fusionne visiblement sans que le
    // motif devienne illisible.
    //
    // Densite 0.5 et non 1 : il FAUT des tranches immobiles: une frontiere
    // decalee/intacte est le contraste maximal, et c est celle-la que le fondu
    // devra adoucir. A densite 1 toutes les tranches bougent et les frontieres
    // les plus franches disparaissent du verrou.
    //
    // Ecart des canaux 0.3 sur une rampe NEUTRE (r = g = b) : la moindre frange
    // coloree dans la reference vient forcement de cet ecart, puisque la source
    // n a aucune chromaticite. Un verrou qui, en plus, sait d ou vient sa
    // couleur.
    "effet-slice-shift": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("sliceShift", p);
        stack.updateParams(a, {
          angle: 0, sliceSize: 32, displace: 0.12, density: 0.5,
          irregular: 0.35, chromaSplit: 0.3, seed: 0,
        });
      },
    },

    // MEME SCENARIO, FONDU A 16 PX. Tout est identique au precedent — meme
    // mire, meme graine, donc EXACTEMENT les memes tranches aux memes endroits.
    // Le seul ecart entre les deux references est le profil de la frontiere, et
    // c est ce qui en fait un A/B et pas deux images qui se ressemblent.
    //
    // 16 px sur des tranches de 32 : la moitie de l epaisseur, donc 8 px de
    // part et d autre de chaque frontiere, et la moitie centrale de chaque
    // tranche garde son decalage plein. A la valeur maximale permise par le
    // clamp (32, soit sliceSize) les deux bandes de fondu d une meme tranche se
    // toucheraient pile au milieu et il ne resterait aucun decalage plein a
    // voir ; la moitie laisse les deux regimes sur la meme image.
    //
    // Ce que la reference doit montrer, et qui se mesure au lieu de se juger :
    // la transition passe de UNE ligne a une quinzaine, aux memes y.
    "effet-slice-shift-fondu": {
      contre: "effet-slice-shift",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("sliceShift", p);
        stack.updateParams(a, {
          angle: 0, sliceSize: 32, displace: 0.12, density: 0.5,
          irregular: 0.35, chromaSplit: 0.3, seed: 0, edgeFeather: 16,
        });
      },
    },

    // LE MEME FONDU, SUR LES BARRES BINAIRES — et ce scenario existe parce que
    // les deux precedents NE PEUVENT PAS decider ce qu on leur avait fait dire.
    //
    // L ERREUR, ecrite ici pour qu elle ne soit pas repayee : sur une rampe
    // AFFINE, melanger deux COORDONNEES et melanger deux COULEURS sont
    // algebriquement la MEME chose, parce que \`mix\` commute avec un
    // echantillonneur affine. La rampe (\`v = x*255/(w-1)\`) est exactement
    // affine ; seule la courbure du transfert sRGB les separe, et seulement aux
    // extremes — 0,03 niveau d ecart moyen sur tout l interieur, mesure. Elle
    // reste parfaite pour le PROFIL du decalage (largeur de transition,
    // monotonie) et elle est structurellement AVEUGLE a la nature du melange.
    // C est le piege de lensBlur, une journee plus tard.
    //
    // Deuxieme tentative ratee, elle aussi instructive : compter un CONTRASTE
    // sur des rayures fines. Un decalage fractionnaire passe par une
    // interpolation bilineaire, qui attenue deja les hautes frequences (pour une
    // periode de 3 px a une fraction de 0,5, le transfert vaut exactement 0,5).
    // Dans la bande de fondu le decalage balaie, donc la fraction balaie, donc
    // l attenuation moyenne chute — un melange de COORDONNEES perd du contraste
    // lui aussi. Mesure : -25 %, contre -29 % attendus d un melange de couleurs.
    // Le contraste ne discrimine pas.
    //
    // CE QUI DISCRIMINE est structurel : un melange de coordonnees ressort
    // TOUJOURS une valeur de la source ; un melange de couleurs FABRIQUE une
    // valeur intermediaire partout ou les deux copies different. Sur des barres
    // binaires, la part de pixels intermediaires se compte :
    //   - coordonnees : seulement les bords de barre (~2 px par periode de 32),
    //     soit quelques pour cent ;
    //   - couleurs : la part de la largeur ou les deux copies sont en desaccord,
    //     soit des dizaines de pour cent, le decalage entre tranches voisines se
    //     comptant en dizaines de pixels.
    // Deux ordres de grandeur separent les deux reponses. Mesure au canal VERT,
    // le seul que \`chromaSplit\` ne decale pas.
    "effet-slice-shift-fondu-barres": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const barres = await mireBarres(W, H);
        const sourceId = await r.photoSources.register(barres);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "barres");
        const a = stack.addLayer("sliceShift", p);
        stack.updateParams(a, {
          angle: 0, sliceSize: 32, displace: 0.12, density: 0.5,
          irregular: 0.35, chromaSplit: 0.3, seed: 0, edgeFeather: 16,
        });
      },
    },

    // GOOEY MERGE, SEUL, et pose le 2026-08-02 pour repondre a une question
    // d Antoine : « tres aliasé effet metal avec des artefacts, c est le but ? »
    //
    // La question ne peut pas se trancher sur sa capture : il y empilait gooey
    // merge SOUS un halftone, donc l effet posait un seuil de metaballe sur une
    // trame de points. Il fallait l isoler.
    //
    // SUR LA MIRE COMMUNE, apres un essai rate qui vaut d etre garde : pose
    // d abord sur la mire a points lumineux isoles — des blobs a fusionner,
    // apparemment le sujet meme de l effet — elle a rendu 5 valeurs distinctes
    // et le garde de signal a refuse d ecrire la reference. La raison est
    // instructive : cette mire est presque entierement NOIRE, donc tout tombe du
    // meme cote du seuil et l iso-surface n a rien a longer. Un effet de seuil a
    // besoin d un champ qui TRAVERSE le seuil, pas de taches isolees.
    // La mire commune le donne — son disque en hautes lumieres est une goutte
    // toute faite, a frontiere courbe, ce qui est exactement ce qu il faut pour
    // juger un crenelage.
    //
    // CE QUE LA REFERENCE REND MESURABLE : l iso-surface se pretend antialiasee
    // analytiquement (plancher fwidth sur la largeur de bascule). Si c est vrai,
    // sa frontiere porte une bande MINCE de valeurs intermediaires ; si l effet
    // crenelait, elle serait franche et il n y en aurait AUCUNE. Meme mesure de
    // population que pour le fondu de sliceShift, et elle marche pour la meme
    // raison : on compte des pixels au lieu de juger une amplitude.
    "effet-gooey-merge": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("gooeyMerge");
        // Tension a 1, DELIBEREMENT : c est la valeur ou la bascule est la plus
        // etroite, donc le PIRE cas pour le crenelage. A 0.8 (le defaut) une
        // transition molle masquerait la question au lieu d y repondre.
        stack.updateParams(a, {
          merge: 4, threshold: 0.5, tension: 1, flow: 0.45,
          rim: 0.45, melt: 0.35, tintHue: 200, tintSaturation: 0.7,
          tintLightness: 0.5, tint: 0.5,
        });
      },
    },

    // Masque : source pinceau (raster) + source parametrique (degrade)
    // combinees, plus le refine edge (adoucissement / contraction / lissage,
    // donc les passes de morphologie separees H/V).
    "masque-pinceau-degrade": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("warp");
        stack.updateParams(a, { scale: 4, amplitude: 0.08, octaves: 4, seed: 2 });
        stack.updateBrushMask(a, brushRaster(W, H));
        const g = stack.addMaskSource(a, "gradient");
        stack.updateMaskSourceParams(a, g, { angle: 0, startX: 0, startY: 0, endX: 1, endY: 1, feather: 0.8, invert: 0 });
        stack.setMaskSourceCombineMode(a, g, "intersect");
        stack.updateRefineEdge(a, { feather: 6, contract: -3, smooth: 2 });
      },
    },

    // Chaine edge-aware (guided filter + SAT) : une dizaine de passes WGSL qui
    // ne s'executent que si la case est cochee, et qui portent leur propre
    // cache invalide par epoque — exactement le genre de chemin ou une
    // regression dort longtemps.
    "masque-edge-aware": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("duotone");
        stack.updateBrushMask(a, brushRaster(W, H));
        stack.updateRefineEdge(a, { feather: 2, edgeAware: true, edgeRadius: 8, edgeStrength: 0.8 });
      },
    },

    // MEME CHAINE, SUR LE CALQUE LE PLUS BAS. Le scenario ci-dessus pose son
    // masque edge-aware sur un calque d'effet POSE SUR le fond : son guide est
    // le composite en dessous, qui contient la mire — il ne pouvait donc pas
    // voir le defaut. Celui-ci pose le masque sur le calque PHOTO DE FOND
    // lui-meme. Jusqu'au 2026-07-29 son guide etait la TOILE, effacee une fois
    // en alpha 0 et jamais uploadee depuis T1 : le filtre guide travaillait sur
    // du vide, sans une seule arete a suivre, et rien ne le disait. Mesure a
    // l'appui (sonde CDP sur GPU reel) : le guide servi au calque du bas etait
    // litteralement la texture de toile. Le guide est desormais la photo du
    // calque lui-meme.
    "masque-edge-aware-calque-du-bas": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        // stack.layers[0] EST le calque photo de fond pose plus haut par le
        // harnais — c'est bien lui, et pas un calque ajoute, qu'on masque.
        const fond = stack.layers[0].id;
        stack.updateBrushMask(fond, brushRaster(W, H));
        stack.updateRefineEdge(fond, { feather: 2, edgeAware: true, edgeRadius: 8, edgeStrength: 0.8 });
      },
    },
  };

  const b64 = (u8) => {
    let s = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    return btoa(s);
  };

  let pass = null;

  /** Relit la SURFACE DE PRESENTATION (le canvas), la ou \`exportFrame\` relit
   *  la texture d'export. Meme reswizzle bgra->rgba que l'export
   *  (\`FrameReadback\`, lecon du 2026-07-24) : sans lui la reference aurait le
   *  rouge et le bleu inverses, ce qui ne se voit pas sur un damier gris. */
  const readCanvas = async (ctx, w, h) => {
    const rb = new FrameReadback(ctx.device, w, h, ctx.srgbFormat.startsWith("bgra"));
    const stripped = rb.stripRowPadding(await rb.readTextureBytes(ctx.context.getCurrentTexture()));
    return rb.swapRedBlueChannels(stripped);
  };

  window.__renderCheck = {
    ids: Object.keys(scenarios),
    width: W,
    height: H,
    async openPass() {
      const cv = document.createElement("canvas");
      // Le canvas est a la taille du DOCUMENT, plus 4x4 : un scenario de
      // surface "canvas" relit ce que la passe de presentation y ecrit, donc
      // la destination doit avoir les dimensions de la reference.
      cv.width = W; cv.height = H;
      const ctx = await initGpu(cv);
      // \`initGpu\` configure sans COPY_SRC (l'app ne relit jamais son canvas).
      ctx.context.configure({
        device: ctx.device,
        format: ctx.canvasFormat,
        viewFormats: [ctx.srgbFormat],
        alphaMode: "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      pass = { ctx, format: ctx.srgbFormat };
      return ctx.srgbFormat;
    },
    closePass() { pass = null; },
    async run(id) {
      const scenario = scenarios[id];
      const toile = scenario.toile ?? { width: W, height: H };
      // Un scenario de surface "canvas" relit la texture de presentation du
      // canvas de la passe, cree en W x H : une toile differente y lirait autre
      // chose que ce qu'elle a rendu. Refus explicite plutot qu'une image
      // silencieusement fausse.
      if (scenario.surface === "canvas" && (toile.width !== W || toile.height !== H)) {
        throw new Error("scenario " + id + " : une toile != " + W + "x" + H + " exige la surface export");
      }
      const r = new Renderer(pass.ctx);
      try {
        // Deuxieme argument = LA TOILE (tranche T2). Omis, \`loadImage\` retombe
        // sur les dimensions du bitmap : c'est le meme chemin de code qu'avant
        // T2, donc les neuf references existantes ne peuvent pas bouger de ce
        // fait.
        await r.loadImage(await mire(W, H, 0), toile);
        // CE QUE FAIT \`App.tsx\` A L'OUVERTURE, en l'APPELANT : \`openDocument\`
        // est le module que \`openFile\` utilise, et il lit les dimensions du
        // calque de fond DANS le renderer. Sans calque de fond le scenario rend
        // une toile vide — et une reference verrouillee sur une image noire ne
        // peut plus rien detecter ; les deux scenarios qui veulent la toile nue
        // le demandent explicitement par \`fond: false\`.
        const stack = scenario.fond === false ? new LayerStack() : openDocument(r, "fond").stack;
        await scenario.build(r, stack);
        const layers = normalize(stack);
        // \`read\` rend un \`{ pixels, width, height }\` — les dimensions du frame
        // REELLEMENT rendu, pas celles que le scenario a declarees. Sur le
        // chemin d'export elles viennent d'\`ExportedFrame\` (le renderer les
        // prend au meme endroit que la relecture GPU) ; sur le chemin canvas
        // elles sont W x H par construction, puisque la surface de presentation
        // est le canvas de la passe, et un scenario de toile differente y est
        // refuse plus haut.
        //
        // C'EST LA CORRECTION DE R3 (2026-07-30). Le harnais reportait
        // \`toile.width/height\`, c'est-a-dire la DECLARATION du scenario : la
        // garde de dimensions comparait donc la reference a ce qu'on avait
        // demande, jamais a ce qui etait sorti. Sur un temoin faisant ignorer
        // \`canvasSize\` a \`loadImage\`, les deux etaient egales (320 = 320), la
        // garde passait, et le script mourait plus loin sur
        // « comparePixels: longueurs differentes (262144 vs 409600) » — bruyant,
        // donc rien de masque, mais ce n'etait pas la garde documentee qui
        // tirait. Meme principe qu'\`ExportedFrame\` dans le produit : les
        // dimensions voyagent AVEC les octets.
        const read = scenario.surface === "canvas"
          ? async () => ({ pixels: (r.render(layers), await readCanvas(pass.ctx, W, H)), width: W, height: H })
          : () => r.exportFrame(layers);
        const first = await read();
        // Deuxieme lecture sur le MEME renderer : separe une instabilite de
        // frame (cache de pipeline, epoque de masque) d'une instabilite de
        // mise en place (device, upload de texture).
        const second = await read();
        let intra = 0;
        for (let i = 0; i < first.pixels.length; i++) if (first.pixels[i] !== second.pixels[i]) intra++;
        return JSON.stringify({
          ok: true,
          intra,
          nLayers: layers.length,
          width: first.width,
          height: first.height,
          pixels: b64(first.pixels),
        });
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
      const r = new Renderer(ctx);
      await r.loadImage(await mire(W, H, 0));
      // Calque photo de fond, comme les scenarios et par le MEME chemin que
      // \`App.tsx\` : sans lui le diagnostic mesurerait la dependance a l'horloge
      // d'une image noire.
      const stack = openDocument(r, "fond").stack;
      const a = stack.addLayer("posterize");
      stack.updateBrushMask(a, brushRaster(W, H));
      const layers = normalize(stack);

      const wait = () => new Promise((res) => setTimeout(res, 120));

      // (1) OVERLAY ETEINT — ce que lit le harnais.
      r.setMaskOverlay(null);
      const exportA = (await r.exportFrame(layers)).pixels;
      await wait();
      const exportB = (await r.exportFrame(layers)).pixels;
      r.render(layers); const canvasA = await readCanvas(ctx, W, H);
      await wait();
      r.render(layers); const canvasB = await readCanvas(ctx, W, H);

      // (2) OVERLAY ARME — \`framePipelineExecutor.run\` injecte
      // performance.now() dans la passe d'overlay (framePipelineExecutor.ts:147).
      r.setMaskOverlay("L1"); // le calque a masque est le SECOND depuis que le fond est un calque
      r.render(layers); const ovCanvasA = await readCanvas(ctx, W, H);
      await wait();
      r.render(layers); const ovCanvasB = await readCanvas(ctx, W, H);

      // (3) la boucle rAF rejoue la meme passe a un autre instant d'horloge.
      r.tickOverlayAnimation(1000); const tickA = await readCanvas(ctx, W, H);
      r.tickOverlayAnimation(1600); const tickB = await readCanvas(ctx, W, H);

      // (4) \`exportFrame\` passe par le MEME \`runPipeline\`, donc par le meme
      // \`maskOverlayLayerId\` : l'overlay ne s'arrete pas au canvas.
      const ovExportA = (await r.exportFrame(layers)).pixels;
      await wait();
      const ovExportB = (await r.exportFrame(layers)).pixels;

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
  return JSON.stringify({
    ids: Object.keys(scenarios),
    width: W,
    height: H,
    // Ce que chaque scenario PROMET de montrer — consomme par la gate de
    // signal cote Node (voir \`verifierSignal\`).
    attentes: Object.fromEntries(
      Object.entries(scenarios).map(([id, s]) => [id, { valeurs: s.valeurs ?? null, contre: s.contre ?? null }]),
    ),
  });
})()`;

/* ── Deroule ────────────────────────────────────────────────────────────── */

function fail(message) {
  console.error("\nECHEC — " + message);
  process.exitCode = 1;
}

/** Nombre de valeurs RGBA distinctes d'une image. Mesure d'ecrasement, pas de
 *  qualite : une image que le pipeline a videe n'en a qu'une. */
function couleursDistinctes(pixels) {
  const vues = new Set();
  for (let i = 0; i < pixels.length; i += 4) {
    vues.add((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3]);
    if (vues.size > 4096) break;
  }
  return vues.size;
}

/** Plancher de richesse d'un scenario NON declare `aplat`. Volontairement bas :
 *  la gate vise l'image ECRASEE (1 a 2 valeurs), pas la pauvreté relative. */
const MIN_COULEURS = 64;
/** Part minimale de canaux qu'un scenario doit changer par rapport a son
 *  scenario `contre`. Cale sur la mesure : le plus discret des cinq effets
 *  (masque-pinceau-degrade, effet confine a un masque) en deplace 7,8 % ; la
 *  frange de bord d'un pixel, elle, n'en fait que 1,6 % — et ne compte meme
 *  pas ici, les deux images la portant. 3 % separe les deux sans etre un
 *  seuil ajuste au dernier chiffre. */
const MIN_PART_SIGNAL = 0.03;

/**
 * ETAGE MANQUANT LE 2026-07-29, ET RAISON D'ETRE DE CETTE FONCTION.
 *
 * La tranche T1 a vide la toile ; les scenarios, qui posaient leur mire dedans,
 * se sont mis a rendre du NOIR UNIFORME. Le harnais l'a signale — mais
 * seulement parce que les references dataient d'avant. Un `--update` de bonne
 * foi aurait fige six images noires en references, et le harnais serait
 * redevenu VERT : vert, muet, et incapable de detecter quoi que ce soit. Un
 * autre agent l'a mesure le meme jour : cinq des six scenarios ne bougeaient
 * plus d'un canal quand on perturbait volontairement la passe passthrough.
 *
 * Cette gate est le garde-fou correspondant, et elle tourne AVANT la
 * comparaison comme avant l'ecriture des references — donc `--update` ne peut
 * pas verrouiller une image sans signal. Deux exigences seulement :
 *  1. une image non `aplat` porte au moins `MIN_COULEURS` valeurs distinctes ;
 *  2. un scenario qui declare `contre` (l'effet est cense TRANSFORMER l'image)
 *     s'ecarte reellement de ce scenario de reference.
 * Ni l'une ni l'autre ne remplace la lecture a l'oeil des references : elles
 * rendent seulement l'ecrasement IMPOSSIBLE A COMMITTER EN SILENCE.
 */
function verifierSignal(results, ids, meta) {
  console.log("Signal (une reference qu'on ne peut plus faire rougir ne prouve rien) :");
  let ok = true;
  for (const id of ids) {
    const attente = meta.attentes[id] ?? { valeurs: null, contre: null };
    const pixels = results[id].pixels;
    const couleurs = couleursDistinctes(pixels);
    const notes = [];
    let bon = true;

    if (attente.valeurs !== null) {
      // Un scenario a palette FINIE (aplat, damier) annonce son compte exact :
      // « au moins N valeurs » n'y voudrait rien dire, et le compte exact est
      // l'assertion la plus forte disponible sur ces images-la.
      if (couleurs !== attente.valeurs) {
        bon = false;
        notes.push(`${attente.valeurs} valeur(s) annoncee(s), ${couleurs} mesuree(s)`);
      } else {
        notes.push(`${couleurs} valeur(s) distincte(s), conforme a sa declaration`);
      }
    } else if (couleurs < MIN_COULEURS) {
      bon = false;
      notes.push(`${couleurs} valeurs distinctes < ${MIN_COULEURS} — image ecrasee`);
    } else {
      notes.push(`${couleurs > 4096 ? ">4096" : couleurs} valeurs distinctes`);
    }

    if (attente.contre) {
      const ref = results[attente.contre];
      if (!ref) {
        notes.push(`ecart vs ${attente.contre} non mesure (hors de ce --scenario)`);
      } else {
        const stats = comparePixels(pixels, ref.pixels);
        const part = stats.differing / pixels.length;
        if (part < MIN_PART_SIGNAL) {
          bon = false;
          notes.push(`ne s'ecarte de ${attente.contre} que sur ${(part * 100).toFixed(3)} % des canaux`);
        } else {
          notes.push(`s'ecarte de ${attente.contre} sur ${(part * 100).toFixed(1)} % des canaux`);
        }
      }
    }

    if (!bon) ok = false;
    console.log(`  ${bon ? "OK  " : "FAIL"}  ${id.padEnd(30)} ${notes.join(", ")}`);
  }
  if (!ok) {
    fail(
      "un scenario au moins ne porte plus de signal : son image est ecrasee, ou son effet\n" +
        "n'agit plus sur l'image. Aucune reference n'a ete comparee ni ecrite — figer une\n" +
        "image morte en reference rendrait le harnais vert et aveugle (vecu le 2026-07-29,\n" +
        "tranche T1 : la toile videe, les scenarios rendaient du noir).",
    );
    return false;
  }
  console.log("  -> chaque scenario montre ce qu'il pretend montrer.\n");
  return true;
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

  console.log(
    `Mire ${meta.width}x${meta.height}, ${ids.length} scenario(s), 2 passes independantes ` +
      "(la toile d'un scenario peut differer — axe `toile`).\n",
  );

  // Passe 1 et passe 2 : deux GPUDevice, deux Renderer, deux chargements.
  const passes = [];
  for (let p = 0; p < 2; p++) {
    const format = await cdp.evaluate("window.__renderCheck.openPass()");
    if (p === 0) console.log(`Format de texture : ${format}\n`);
    const results = {};
    for (const id of ids) {
      const raw = JSON.parse(await cdp.evaluate(`window.__renderCheck.run(${JSON.stringify(id)})`));
      if (!raw.ok) throw new Error(`scenario ${id} : ${raw.error}`);
      const pixels = new Uint8Array(Buffer.from(raw.pixels, "base64"));
      // AUTO-CONTROLE de l'instrument, pas du sujet : les dimensions rendues
      // doivent rendre compte des octets recus, sinon c'est le harnais qui est
      // casse et tout verdict aval est du bruit. Sans ce controle, une
      // dimension fausse ne se manifesterait que par une exception dans
      // `comparePixels`, plus loin et sous un autre nom (defaut R3).
      if (pixels.length !== raw.width * raw.height * 4) {
        throw new Error(
          `scenario ${id} : le harnais rend ${raw.width}x${raw.height} (= ${raw.width * raw.height * 4} octets) ` +
            `mais ${pixels.length} octets de pixels — l'instrument est incoherent, pas le rendu.`,
        );
      }
      results[id] = { pixels, intra: raw.intra, nLayers: raw.nLayers, width: raw.width, height: raw.height };
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
      `  ${ok ? "OK  " : "FAIL"}  ${id.padEnd(30)} toile ${a.width}x${a.height}  ${a.nLayers} calque(s)` +
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

  // ── Etape 1 bis : chaque scenario PORTE-T-IL UN SIGNAL ?
  if (!verifierSignal(passes[0], ids, meta)) return;

  // ── Etape 2 : comparaison aux references.
  if (UPDATE) {
    mkdirSync(REF_DIR, { recursive: true });
    for (const id of ids) {
      const file = path.join(REF_DIR, `${id}.png`);
      const res = passes[0][id];
      const png = encodePng(res.pixels, res.width, res.height);
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
      console.log(`  ABSENT ${id.padEnd(30)} pas de reference — \`node scripts/render-check.mjs --update\``);
      continue;
    }
    const ref = decodePng(readFileSync(file));
    const res = passes[0][id];
    // Dimensions du FRAME REELLEMENT RENDU contre celles de la reference. Elles
    // viennent d'`ExportedFrame` (ou de la surface de la passe), jamais de la
    // declaration du scenario : c'est la correction de R3 — comparer la
    // declaration a elle-meme laissait cette garde muette et l'echec sortait
    // plus loin, en exception de `comparePixels`. Verifie contre le nombre
    // d'octets recus a la collecte (ci-dessus), donc cette ligne ne peut plus
    // mentir dans un sens ni dans l'autre.
    if (ref.width !== res.width || ref.height !== res.height) {
      regressions++;
      console.log(`  FAIL   ${id.padEnd(30)} dimensions ${ref.width}x${ref.height} vs ${res.width}x${res.height}`);
      continue;
    }
    const stats = comparePixels(passes[0][id].pixels, ref.pixels);
    const { verdict, raison } = verdictFor(stats);
    const accepte = verdict === "identique" || (verdict === "infra-lsb-epars" && TOLERER_ARRONDI);
    if (!accepte) regressions++;
    const tag = accepte ? (verdict === "identique" ? "OK    " : "TOLERE") : "FAIL  ";
    console.log(
      `  ${tag} ${id.padEnd(30)} ${raison}` +
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
