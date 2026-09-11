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
// La texture de test des scenarios `texture` et `encre` est GENEREE DANS LA
// PAGE (`mireEncre`), pas lue sur disque : ce harnais n a AUCUN acces IPC,
// ses modules venant d un Vite separe dont Tauri refuse les commandes. Il n y
// a donc aucun chemin a resoudre ici — voir `TEXTURE_MIRE` dans le bloc
// injecte, qui n est qu un identifiant de catalogue.

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
/** Eprouve les declarations « Sans objet » du registre au lieu de comparer aux
 *  references. Rien a voir avec la non-regression : ce mode ne lit ni n'ecrit
 *  `test/render-refs/`, il MESURE si un curseur declare inerte l'est.
 *  Table dans `scripts/applicabilite-table.mjs`. */
const APPLICABILITE = has("--applicabilite");
const DECL_ONLY = flag("--declaration", null);
/** Ecrit les deux rendus de chaque configuration en PNG, pour REGARDER un
 *  verdict au lieu de le lire. Un chiffre dit qu'un curseur bouge ; il ne dit
 *  pas ce qu'il fait, et c'est ce qu'il fait qui s'arbitre. */
const IMAGES = flag("--images", null);

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
  // Chemin ABSOLU de la texture de test, injecte depuis Node : la page ne
  // connait pas la racine du depot.
  // Identifiant de la texture au catalogue. Le port de decodage ignore ce
  // chemin et rend la mire generee — il n existe aucun fichier derriere.
  const TEXTURE_MIRE = "mire-encre-generee";
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
  // MIRE D ENCRE, pour les scenarios a texture de bibliotheque. Deterministe et
  // GENEREE dans la page : le harnais n a pas d IPC (ses modules viennent d un
  // Vite separe, et Tauri restreint ses commandes a l origine de l app), donc
  // aucun fichier ne peut etre lu ici. Une mire generee est de toute facon plus
  // reproductible qu un fichier versionne.
  //
  // Deux echelles superposees, et chacune sert un scenario different :
  //  - cellules de 32 px et bandes diagonales : des STRUCTURES que la rotation
  //    et le decalage de l effet texture deplacent visiblement ;
  //  - detail au pixel : ce que la bavure d encre preleve en haut de bande. Sans
  //    lui, le prelevement rend zero et le verrou ne dirait rien de l encre.
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

  // Mire A BANDES, pour les six modes de fusion du 2026-08-18.
  //
  // POURQUOI AUCUNE MIRE EXISTANTE NE PEUT LES MONTRER. Quatre des six modes
  // (Teinte, Saturation, Couleur, Luminosite) DECOMPOSENT la couleur du dessus
  // en trois attributs et n en reprennent qu un ou deux. Un calque du dessus
  // qui ne fait pas varier ces attributs INDEPENDAMMENT rend donc les quatre
  // modes visuellement proches, et le verrou ne saurait pas dire lequel est
  // branche sur lequel. La mire commune ne le peut pas : sa teinte, sa
  // saturation et sa luminosite bougent toutes les trois avec x et y.
  //
  // Quatre bandes horizontales, et le couple des deux premieres EST le temoin :
  //
  //   0  rouge sature      Lum  86   Sat 170
  //   1  gris              Lum  86   Sat   0   <- MEME luminosite que la 0
  //   2  bleu peu sature   Lum 129   Sat  70
  //   3  vert sature clair Lum 173   Sat 125
  //
  // Les bandes 0 et 1 ne different QUE par la chromaticite, a luminosite egale
  // (coefficients 0,3 / 0,59 / 0,11, ceux des modes eux-memes) : 0,3 x 205 +
  // 0,59 x 35 + 0,11 x 35 = 86, exactement la valeur du gris.
  //
  // ⚠️ CE TEMOIN NE SE LIT PAS DANS CES REFERENCES, et l avoir cru est le
  // defaut que la mesure a corrige. Le fond varie lui aussi avec y (son canal
  // vert EST y, plus le damier) : aucun couple de pixels de l image n a le meme
  // dessous, donc comparer la bande 0 a la bande 1 melange la reponse du mode a
  // la variation du fond. La premiere lecture rendait 41,1 de moyenne et ne
  // prouvait rien.
  //
  // MESURE A PART, le 2026-08-18, par quatre scenarios TEMPORAIRES retires
  // apres lecture (meme patron que les conditions de section de \`lensFlare\`) :
  // un dessus UNI rouge (205,35,35) contre un dessus UNI gris (86,86,86), sur
  // le meme fond, dans les deux modes.
  //
  //   Luminosite : max 1, moyenne 0,136 — 86 % des canaux identiques au bit
  //                pres, le reste a 1 LSB (l aller-retour sRGB de la voie
  //                photo, pas le mode). Le mode ne voit QUE la luminosite.
  //   Couleur    : max 120, moyenne 51,2. Le mode ne voit QUE la chromaticite.
  //
  // Ce que ces references verrouillent, elles, est l ecart ENTRE modes — voir
  // la chaine des \`contre\` plus bas, qui est ce que le harnais sait mesurer.
  //
  // Bandes horizontales et non verticales : le degrade rouge de la mire de
  // fond suit x, donc chaque bande voit toute son etendue.
  const mireFusion = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    const bandes = [[205, 35, 35], [86, 86, 86], [110, 130, 180], [120, 215, 90]];
    for (let y = 0; y < h; y++) {
      const bande = bandes[Math.min(3, Math.floor((y * 4) / h))];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        d[i] = bande[0]; d[i + 1] = bande[1]; d[i + 2] = bande[2]; d[i + 3] = 255;
      }
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  // Six teintes plates, en sRGB. Elles sont posees ici plutot que dans la mire
  // parce que le scenario du range couleur doit ECHANTILLONNER exactement les
  // memes valeurs : deux listes se seraient desaccordees au premier ajustement,
  // et le mode de defaillance est muet — le masque devient vide, et une
  // reference de masque vide ressemble a une reference.
  const PASTILLES = [
    [220, 40, 40],
    [40, 180, 60],
    [50, 70, 210],
    [235, 205, 50],
    [40, 190, 200],
    [200, 60, 170],
  ];

  // Mire A PASTILLES : six aplats de teintes franches, en grille 3 x 2.
  //
  // Elle existe pour UNE source de masque, le range couleur, et aucune mire
  // existante ne pouvait en temoigner. Cette source mesure une distance
  // colorimetrique a un echantillon : ce qu il faut lui montrer, ce sont des
  // couleurs SEPAREES et PLATES. La mire commune fait exactement l inverse —
  // ses canaux rouge et vert sont deux degrades continus, donc la distance y
  // varie sans palier et le masque sort en tache floue dont on ne peut pas dire
  // si elle suit la couleur echantillonnee ou seulement la position.
  //
  // Aplats et non degrades, donc, pour que la reponse soit BINAIRE la ou elle
  // doit l etre : une pastille est dedans ou dehors, et une pastille qui
  // basculerait se verrait a l octet.
  //
  // SIX et non deux, parce que la propriete a prouver n est pas « il selectionne
  // une couleur » mais « il selectionne LES couleurs echantillonnees et pas les
  // autres ». Avec deux pastilles, un masque qui prendrait tout passerait.
  // Distances mesurees en lineaire : les deux pastilles echantillonnees sont a
  // 0, la plus proche des quatre autres est a 0,4057. La tolerance de 0,20 du
  // scenario a donc deux fois la marge necessaire, ce qui rend le verrou
  // insensible au bruit d encodage et sensible a un vrai changement de calcul.
  //
  // ⚠️ CHAQUE PASTILLE PORTE UNE VARIATION DE +/-4 %, ET CE N EST PAS DECORATIF.
  // La premiere version rendait six aplats STRICTEMENT plats : la gate de signal
  // l a refusee sur-le-champ, avec deux valeurs distinctes pour un plancher de
  // 64. C est logique et pas contournable — six aplats traverses par un
  // operateur par pixel ne peuvent donner que six valeurs. Une reference figee
  // dessus aurait ete inerte, ce que la gate existe precisement pour empecher.
  //
  // L amplitude est MESUREE, pas choisie a l oeil, et c est le seul reglage qui
  // compte ici. La rampe est diagonale pour multiplier le nombre de paliers a
  // amplitude egale. A +/-4 %, les deux pastilles visees restent a 0,068 au pire
  // de leur echantillon — sous le debut de la bande de transition (0,095), donc
  // selectionnees en entier ; les quatre autres restent a 0,394 au mieux — au-dela
  // de la tolerance (0,200), donc exclues en entier. A +/-6 % la premiere
  // condition tombe (0,099) et le bord des pastilles visees commencerait a
  // s effriter. La marge est donc reelle des deux cotes, et elle est etroite d un
  // seul : ne pas monter l amplitude sans refaire le calcul.
  const mirePastilles = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const col = Math.min(2, ((x * 3) / w) | 0);
        const row = Math.min(1, ((y * 2) / h) | 0);
        const p = PASTILLES[row * 3 + col];
        // Position DANS la pastille, 0..1 sur chaque axe, puis rampe diagonale
        // centree : le centre geometrique de chaque pastille vaut exactement la
        // couleur declaree, ce qui permet au scenario d echantillonner PASTILLES
        // tel quel plutot qu une moyenne a recalculer.
        const u = ((x * 3) / w) - col;
        const v = ((y * 2) / h) - row;
        const f = 1 + 0.04 * ((u + v) - 1);
        d[i] = Math.round(p[0] * f);
        d[i + 1] = Math.round(p[1] * f);
        d[i + 2] = Math.round(p[2] * f);
        d[i + 3] = 255;
      }
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  // Mire A PRIMAIRES : les six teintes plates (R, V, B et leurs secondaires C, M,
  // J) a 100 % et 50 % de saturation, une bande de PEAU, et une rampe de gris.
  //
  // Elle existe pour l effet etalonnage, et aucune mire existante ne pouvait en
  // temoigner. L etalonnage tourne les PRIMAIRES du systeme de couleur : ce qui
  // le montre, ce sont des aplats de couleurs FRANCHES qui basculent en teinte, et
  // une rampe de gris qui, elle, ne DOIT PAS bouger (c est la preuve de la
  // renormalisation au blanc). La mire commune fait l inverse — deux degrades
  // continus ou une rotation de primaire se noie.
  //
  // Trois lectures dans une image :
  //  - deux rangees de six aplats : la rotation d une primaire s y lit d un coup,
  //    et une secondaire (C = V+B) prouve que l effet agit sur une COMBINAISON et
  //    pas sur une bande isolee ;
  //  - la bande de peau (#E0A080) : c est la que tout etalonnage se juge, une
  //    teinte chair virant au vert ou au magenta se voit avant tout le reste ;
  //  - la rampe de gris en bas : elle porte les OMBRES (pour la nuance foncee) et
  //    prouve l invariance des gris de la matrice.
  const mirePrimaires = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    // 100 % de saturation : primaires puis secondaires.
    const pleines = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 255, 255], [255, 0, 255], [255, 255, 0]];
    // 50 % de saturation : le canal manquant remonte a mi-course, la valeur reste
    // haute. Une teinte moins pure ou l etalonnage agit plus subtilement.
    const demi = [[255, 128, 128], [128, 255, 128], [128, 128, 255], [128, 255, 255], [255, 128, 255], [255, 255, 128]];
    const peau = [224, 160, 128];
    const yA = Math.round(h * 0.36); // fin des aplats pleins
    const yB = Math.round(h * 0.60); // fin des aplats a demi-saturation
    const yC = Math.round(h * 0.74); // fin de la bande de peau
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let c;
        if (y < yA) {
          c = pleines[Math.min(5, ((x * 6) / w) | 0)];
        } else if (y < yB) {
          c = demi[Math.min(5, ((x * 6) / w) | 0)];
        } else if (y < yC) {
          c = peau;
        } else {
          const v = ((x * 255) / (w - 1)) | 0;
          c = [v, v, v];
        }
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  // sRGB 0..255 vers lumiere lineaire 0..1. Le range couleur compare a
  // \`colorLinear\`, donc un echantillon donne en sRGB viserait a cote — et pas
  // un peu : 220 sur 255 vaut 0,86 en sRGB et 0,72 en lineaire, soit plus de
  // deux fois la tolerance du scenario. Le masque serait vide, sans erreur.
  const versLineaire = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
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

  // Mire A LAMPES : quatre sources vives de teintes franchement differentes,
  // posees DEUX FOIS — une fois sur du presque noir, une fois sur un fond clair.
  //
  // Aucune mire existante ne pouvait temoigner d une halation, et le manque
  // etait exactement celui que la famille des halos rend critique : glow,
  // halation et anamorphicStreak partent tous du meme bright-pass, et ce qui les
  // separe est ce qu ils FONT de l energie collectee. Deux proprietes distinguent
  // la halation des deux autres, et cette mire porte les deux :
  //  - LA COULEUR DE LA SOURCE EST JETEE. Le fichier de l effet le declare en
  //    toutes lettres au bright-pass (« la garder aurait fait transparaitre la
  //    teinte de la source dans le halo, ce qui est le comportement d un bloom »)
  //    et rien ne le verrouillait. Quatre sources de teintes tres differentes le
  //    rendent lisible d un coup d oeil : soit UN halo de la meme couleur autour
  //    des quatre, soit quatre halos de couleurs differentes, et il n y a pas de
  //    cas intermediaire ambigu.
  //  - LE HALO S EFFACE SUR FOND CLAIR. C est le terme de film, et sur du noir il
  //    est mathematiquement INERTE : \`poidsFond\` vaut 1 des que le fond est
  //    sombre. Un fond clair est donc la seule facon d exercer ce parametre, et
  //    il fallait les deux fonds dans la MEME image pour que la comparaison ne
  //    depende pas d un reglage change entre deux rendus.
  //
  // Fond clair a 160 et pas plus, a dessein : au-dela il passe lui-meme le seuil
  // du bright-pass et se met a halater sur toute sa surface, ce qui noierait les
  // quatre sources qu on veut lire. La mire est calibree contre le seuil du
  // scenario, pas choisie a l oeil.
  const mireLampes = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = x < (w >> 1) ? 10 : 160;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
    }
    // Les quatre teintes saturent AU MOINS un canal : le bright-pass lit
    // \`max(r, g, b)\`, donc les quatre franchissent le seuil de la meme facon et
    // la seule chose qui les separe est leur couleur. Sans cette precaution on
    // comparerait des halos d energies differentes, et une teinte residuelle se
    // confondrait avec un ecart d intensite.
    const teintes = [[255, 255, 255], [255, 110, 40], [60, 255, 90], [70, 110, 255]];
    const rr = 9;
    for (let col = 0; col < 2; col++) {
      for (let row = 0; row < 4; row++) {
        const cx = col === 0 ? w >> 2 : (w * 3) >> 2;
        const cy = ((row * 2 + 1) * h) >> 3;
        const t = teintes[row];
        for (let y = cy - rr; y <= cy + rr; y++) {
          for (let x = cx - rr; x <= cx + rr; x++) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rr * rr) continue;
            const i = (y * w + x) * 4;
            d[i] = t[0]; d[i + 1] = t[1]; d[i + 2] = t[2];
          }
        }
      }
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  // Mire A DAMIER NEUTRE : un damier fin, r = g = b partout, sur toute la toile.
  //
  // La mire commune a bien un damier, mais il est pose sur un degrade ou le
  // rouge croit en x et le vert en y : elle porte DEJA de la chromaticite
  // partout, et une frange coloree ne s y distingue pas de son fond. Ici la
  // source n a aucune couleur, donc tout pixel colore de la sortie est FABRIQUE
  // par la dispersion — c est le raisonnement des barres binaires de sliceShift,
  // porte a deux dimensions parce qu une aberration radiale deplace en x ET en y
  // (des barres uniformes en y rendraient la moitie du deplacement invisible).
  //
  // Cellule de 8 px et non 16 : une frange se lit contre une arete, donc plus il
  // y a d aretes par unite de rayon, plus la croissance du decalage du centre
  // vers les coins — la promesse meme du parametre \`centerFalloff\` — est
  // lisible. Uniforme sur toute la toile pour que la comparaison centre/coins
  // porte sur le meme contenu.
  const mireDamierNeutre = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = (((x >> 3) ^ (y >> 3)) & 1) ? 224 : 32;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
    }
    return createImageBitmap(new ImageData(d, w, h), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  };

  // MIRE DU VERRE (2026-08-03) — ecrite AVANT la premiere ligne du shader, et
  // c est le point du plan de portage sur lequel tout le reste repose.
  //
  // POURQUOI AUCUNE MIRE EXISTANTE NE CONVIENT. Un verre imprime doit montrer
  // QUATRE choses, et elles demandent des sujets contradictoires :
  //   1. le DEPLACEMENT par refraction -> du contraste fin
  //   2. la DISPERSION -> un bord ACHROMATIQUE (un lisere rouge sur du rouge ne
  //      se voit pas, et la mire commune est coloree partout)
  //   3. la PERIODICITE des stries -> un aplat uni traverse d un bord droit ;
  //      sur un damier, la periode des cases BAT avec celle des stries et
  //      produit un crenelage qu on prendrait pour un defaut du shader
  //   4. la DIFFUSION du depoli -> du detail haute frequence qui DISPARAIT
  //
  // TOUTE LA MIRE EST ACHROMATIQUE, et ce n est pas une economie : r = g = b
  // partout signifie que **la moindre couleur en sortie EST la dispersion**.
  // La propriete devient mesurable au lieu d etre appreciee — c est la reponse
  // exacte au probleme de lensBlur, dont dix-sept tests verts ne voyaient pas
  // qu il floutait au double du rayon parce que sa mire ne pouvait pas le dire.
  //
  // Quatre quadrants, quatre lectures, une seule image.
  const mireVerre = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    // Hachage deterministe : \`Math.random\` briserait la reproductibilite que
    // tout ce harnais existe pour prouver.
    const hache = (x, y) => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const demiW = w >> 1, demiH = h >> 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let v;
        if (y < demiH && x < demiW) {
          // (1) Damier FIN, 4 px : le detail que la refraction deplace et que
          // la diffusion efface. Pas 8 px comme mireDamierNeutre — on veut ici
          // une frequence proche de celle des stries, pas loin d elle.
          v = (((x >> 2) ^ (y >> 2)) & 1) ? 228 : 28;
        } else if (y < demiH) {
          // (2) APLAT UNI traverse d UN SEUL bord droit, oblique. Aucune
          // periode, donc aucun battement possible avec la cannelure : ce qui
          // ondule ici ondule a cause du verre, et de rien d autre. L oblique
          // plutot que la verticale pour que le bord coupe les stries quel que
          // soit leur axe.
          const t = (x - demiW) * 0.6 + (y - 0) * 0.8;
          v = t > demiW * 0.55 ? 236 : 120;
        } else if (x < demiW) {
          // (3) RAMPE horizontale lisse. Un deplacement s y lit comme une
          // marche de ton la ou il n y en avait aucune — la lecture la plus
          // sensible des quatre, et la seule qui chiffre l amplitude.
          v = Math.round((x / (demiW - 1)) * 255);
        } else {
          // (4) HAUTE FREQUENCE, un texel sur deux tire. Le depoli n a aucun
          // relief : il ne deplace rien, il DIFFUSE. Le seul endroit ou son
          // action se voie est une zone dont le detail peut disparaitre.
          v = 40 + Math.round(hache(x, y) * 200);
        }
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

    // RECADRAGE DE TOILE (ticket 32, tranche A). Le cadre ne decoupe qu a la
    // presentation et a l export ; le pipeline compose la toile ENTIERE en
    // espace d origine. Le temoin rend la mire pleine (256x256), la reference
    // cadree le quart central (128x128) — la MEME pile, seul le cadre change.
    // Pas de contre entre les deux : ils n ont pas la meme taille. La preuve
    // du non-glissement est l assertion de crop octet-exact du harnais (voir
    // \`run\`), pas un ecart de deux references.
    "cadre-toile-temoin": {
      build: async () => {},
    },
    "cadre-toile": {
      cadre: { x: 64, y: 64, width: 128, height: 128 },
      build: async () => {},
    },

    // LE MEME CADRE SUR UN MASQUE DEGRADE. Ses quatre points vivent en UV de la
    // TOILE : si le pipeline evaluait dans l espace du cadre, le degrade
    // glisserait par rapport a la photo. L assertion de crop du harnais prouve
    // qu il ne bouge pas — l export cadre est le crop octet-exact de l export
    // plein. La reference committee est le quart central (128x128).
    "cadre-toile-degrade": {
      fond: false,
      cadre: { x: 64, y: 64, width: 128, height: 128 },
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("duotone", p);
        stack.updateParams(a, {
          shadowHue: 350, shadowSaturation: 0.65, shadowLightness: 0.25,
          midtoneHue: 30, midtoneSaturation: 0.5, midtoneLightness: 0.5,
          highlightHue: 220, highlightSaturation: 0.55, highlightLightness: 0.6,
          contrast: 0.55, pivot: 0.5,
        });
        const g = stack.addMaskSource(a, "gradient");
        stack.updateMaskSourceParams(a, g, {
          angle: 90, startX: 0.5, startY: 0.15, endX: 0.5, endY: 0.85, feather: 0.12, invert: 0,
        });
      },
    },

    // Multi-passes (glow = 5 passes internes) + effet simple, avec opacite et
    // mode de fusion non triviaux.
    //
    // Le second calque etait \`posterize\` jusqu au 2026-08-03 ; l effet est sorti
    // du registre (ADR-0012) et c est \`dither\` qui prend sa place. Les trois
    // reglages non par defaut ci-dessous ne sont pas une preference : ce sont
    // ceux qui redonnent le comportement de \`posterize\` — trame eteinte
    // (\`amount\` 0), quantification par CANAL et non deux encres (\`mono\` 0), axe
    // LINEAIRE (\`distribution\` 0, la ou le defaut de dither est Perceptuel).
    // Ce scenario ne verrouille de toute facon pas la quantification mais la
    // COMPOSITION — cinq passes internes, deux opacites, deux modes de fusion.
    "effets-glow-dither": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("glow");
        stack.updateParams(a, { threshold: 0.55, intensity: 1.6 });
        const b = stack.addLayer("dither");
        stack.updateParams(b, { levels: 4, amount: 0, mono: 0, distribution: 0 });
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
        // PASSAGER, pas le sujet : ce scenario verrouille la double exposition
        // (transform du calque photo + fusion), et l effet pose dessus ne sert
        // qu a prouver qu un effet s applique bien au resultat. Il portait
        // chromaticBleed jusqu au 2026-08-03 ; l effet a ete absorbe par le
        // mode Laterale de lensDistortion (ADR-0016) et les reglages sont
        // transposes ici. La reference a donc ete regeneree — inevitable, et
        // sans consequence sur ce que ce scenario prouve.
        const c = stack.addLayer("lensDistortion", p);
        stack.updateParams(c, {
          distortion: 0, aberration: 0.05, aberrationMode: 0, centerFalloff: 1.5,
          centerPresence: 0.35, aberrationAngle: 0, streakIntensity: 0,
        });
      },
    },

    // MIROIR — echelle NEGATIVE (ticket 05, echelles signees). Le calque photo
    // est retourne sur X par scaleX = -1. La mire generique est asymetrique
    // gauche/droite (degrade rouge horizontal, tics sombres en bas a GAUCHE),
    // donc le retournement se VOIT : le temoin (scaleX +1) et le miroir
    // (scaleX -1) ne different que par ce basculement de contenu.
    //
    // Mais le vrai sujet est la COUVERTURE, pas le contenu. Le feather de bord
    // multipliait une distance par l'echelle SIGNEE ; a scaleX < 0 l'alpha
    // s'inversait sur l'axe miroite — trou a la place de l'image, bande opaque
    // a cote (mesure §5). Corrige en \`abs()\`. Sans la correction, le miroir
    // ci-dessous rendrait la photo quasi transparente au lieu de la mire
    // retournee : un ecart massif, donc un garde franc.
    //
    // Photo PLUS PETITE que la toile (176x132 sur 256x256), et \`fond: false\` :
    // ses quatre bords ET le passe-partout autour sont dans le cadre. Une mire
    // cadree sur l'image seule verrait le trou de l'inversion mais pas la
    // bande, et c'est la bande le vrai piege (§5).
    "photo-miroir-temoin": {
      fond: false,
      build: async (r, stack) => {
        const photo = await mire(176, 132, 0);
        const sourceId = await r.photoSources.register(photo);
        stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "miroir");
      },
    },
    "photo-miroir": {
      contre: "photo-miroir-temoin",
      fond: false,
      build: async (r, stack) => {
        const photo = await mire(176, 132, 0);
        const sourceId = await r.photoSources.register(photo);
        stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: -1, scaleY: 1, rotation: 0 }, "miroir");
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

    // COURBURE DES LAMES — meme mire, memes reglages, une seule valeur change.
    // Le scenario ci-dessus est son TEMOIN : il tourne a courbure 0, donc
    // l ecart entre les deux references EST l effet du parametre, et rien
    // d autre. C est la seule facon de prouver qu un curseur ajoute agit, un
    // curseur mort ne deplacant aucun pixel precisement parce qu il est mort.
    //
    // Six lames et non trois : c est le diaphragme des objectifs courants, et
    // c est aussi la ou le modele est le plus juste (l ecart a l arc exact
    // tombe a 0,16 % des six lames, contre 3,16 % au triangle — mesure dans
    // aperture.test.ts). Un scenario a trois lames verrouillerait le pire cas
    // du modele au lieu de son cas d usage.
    //
    // La mire est celle du temoin, mireBokeh : des points lumineux ISOLES sur
    // du sombre. Une tache de bokeh est l image de l ouverture elle-meme, donc
    // seule une source quasi ponctuelle la montre — sur un damier, une
    // ouverture ronde et une ouverture hexagonale rendent la meme bouillie.
    "effet-lens-blur-bokeh-courbe": {
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
          bladeCurvature: 1,
          highlightThreshold: 0.35,
          highlightBoost: 14,
          fieldShape: 0,
        });
      },
    },

    // RETENUE DES NOIRS DU GLOW — le temoin, a retenue nulle.
    //
    // La mire est mireLampes, et le choix est la mesure : sa moitie gauche est
    // DENSE (valeur 10) et sa moitie droite CLAIRE (valeur 160), avec les memes
    // quatre lampes saturees des deux cotes. C est la seule mire du script qui
    // porte les deux densites sous des sources identiques — donc la seule ou
    // une porte qui depend de la densite du fond puisse se lire sans confondre
    // son effet avec une difference de source.
    //
    // A retenue nulle, le halo se pose des deux cotes : c est le Pro-Mist, et
    // c est le rendu d avant le 2026-08-19. La reference suivante ne change que
    // shadowHold.
    "effet-glow-retenue-temoin": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const lampes = await mireLampes(W, H);
        const sourceId = await r.photoSources.register(lampes);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "lampes");
        const a = stack.addLayer("glow", p);
        stack.updateParams(a, {
          threshold: 0.45, knee: 0.6, intensity: 2.2, spread: 1.2,
          shadowHold: 0, shadowHoldPoint: 0.35,
        });
      },
    },

    // RETENUE DES NOIRS DU GLOW — a fond. Le halo doit disparaitre de la moitie
    // DENSE et rester entier sur la moitie claire : c est le Black Pro-Mist,
    // dont les particules noires absorbent la lumiere diffusee qui retomberait
    // dans les zones denses.
    //
    // Ce que la paire verrouille, et qui ne se verrouille pas autrement : que
    // la porte lit la densite de ce qui est SOUS le halo. Un shader qui lirait
    // la luminance du HALO rendrait aussi une image differente du temoin — donc
    // une reference seule ne separerait pas les deux. C est la moitie GAUCHE de
    // cette reference qui les separe : sous le halo elle est dense, dans le
    // halo elle ne l est pas.
    "effet-glow-retenue": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const lampes = await mireLampes(W, H);
        const sourceId = await r.photoSources.register(lampes);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "lampes");
        const a = stack.addLayer("glow", p);
        stack.updateParams(a, {
          threshold: 0.45, knee: 0.6, intensity: 2.2, spread: 1.2,
          shadowHold: 1, shadowHoldPoint: 0.35,
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

    // ISOLINES SUR LA RAMPE — et la mire est LE test, pour une raison qui est
    // toute la promesse de l effet. La rampe a une pente qui VARIE le long de
    // l image (c est un degrade non lineaire), donc des niveaux egalement
    // espaces y tombent a des distances differentes. Un effet dont la largeur
    // de trait suivrait la pente — ce que donne posterize + outlines empiles —
    // y rendrait des traits d epaisseurs visiblement inegales. Ici ils doivent
    // etre tous a la meme largeur, et c est mesurable.
    //
    // Courbe maitresse DESACTIVEE dans ce scenario (majorEvery tres grand) :
    // elle est faite pour etre plus epaisse, donc elle fausserait justement la
    // mesure d uniformite. Elle a son propre scenario juste apres.
    // Peu de valeurs, et c est CONFORME : des traits noirs antialiases sur un
    // fond blanc uni n en produisent qu une par palier d antialiasing. Le
    // compte est declare plutot que le plancher contourne — il devient alors
    // une assertion de plus, et un changement d antialiasing le fera rougir.
    "effet-isolines": {
      contre: "photo-de-fond-seule",
      valeurs: 26,
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("isolines", p);
        stack.updateParams(a, {
          levels: 14, thickness: 2, smoothing: 3, inputMode: 0,
          blackPoint: 0, whitePoint: 1,
          majorEvery: 12, majorWidth: 1,
          lowHue: 0, lowSaturation: 0, lowLightness: 0,
          highHue: 0, highSaturation: 0, highLightness: 0,
          wash: 1, backgroundHue: 0, backgroundSaturation: 0, backgroundLightness: 1,
        });
      },
    },

    // LA MEME CHOSE AVEC LES COURBES MAITRESSES. Une courbe sur quatre est
    // tracee 2,6 fois plus epaisse — c est ce qui rend un faisceau comptable a
    // l oeil sur une vraie carte. Ce scenario existe pour que le mecanisme soit
    // verrouille separement de l uniformite : les deux se contredisent par
    // construction, et les melanger dans une seule image rendrait chacun des
    // deux invisible a la mesure de l autre.
    "effet-isolines-maitresses": {
      contre: "effet-isolines",
      valeurs: 25,
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("isolines", p);
        stack.updateParams(a, {
          levels: 14, thickness: 2, smoothing: 3, inputMode: 0,
          blackPoint: 0, whitePoint: 1,
          majorEvery: 4, majorWidth: 2.6,
          lowHue: 0, lowSaturation: 0, lowLightness: 0,
          highHue: 0, highSaturation: 0, highLightness: 0,
          wash: 1, backgroundHue: 0, backgroundSaturation: 0, backgroundLightness: 1,
        });
      },
    },

    // DITHER, SUR LA RAMPE — et la mire est le test. Un tramage existe pour
    // rendre un DEGRADE avec peu de niveaux : c est la seule chose qu il sait
    // faire mieux qu une quantification nue, donc la seule sur laquelle il
    // faille le juger. Sur le damier, ses aplats seraient quantifies sans qu on
    // voie jamais le motif travailler.
    //
    // Deux niveaux (1 bit) DELIBEREMENT : c est le regime ou le motif porte
    // toute l information, donc le pire cas et le plus lisible.
    // Le compte de valeurs declare n est pas un contournement du garde de
    // signal, c est une ASSERTION : a deux niveaux, avec une encre noire et un
    // papier blanc, une image correcte ne PEUT contenir que deux valeurs. Trois
    // signaleraient une quantification qui fuit.
    "effet-dither": {
      contre: "photo-de-fond-seule",
      valeurs: 2,
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("dither", p);
        stack.updateParams(a, {
          style: 0, size: 2, levels: 2, mono: 1,
          blackPoint: 0, whitePoint: 1,
          inkHue: 0, inkSaturation: 0, inkLightness: 0,
          paperHue: 0, paperSaturation: 0, paperLightness: 1,
        });
      },
    },

    // LE MEME, EN BRUIT BLEU. Ce scenario existe pour une raison precise : il
    // est le SEUL a pouvoir dire que les deux styles ne sont pas le meme code.
    // Tout le reste est identique — meme mire, meme taille, memes deux niveaux,
    // memes encres — donc ce qui separe les deux images ne peut venir que du
    // motif. Un style branche sur la mauvaise fonction rendrait deux images
    // identiques, et aucun test unitaire ne le verrait.
    "effet-dither-bruit-bleu": {
      contre: "effet-dither",
      valeurs: 2,
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("dither", p);
        stack.updateParams(a, {
          style: 1, size: 2, levels: 2, mono: 1,
          blackPoint: 0, whitePoint: 1,
          inkHue: 0, inkSaturation: 0, inkLightness: 0,
          paperHue: 0, paperSaturation: 0, paperLightness: 1,
        });
      },
    },

    // LES QUATRE STYLES AJOUTES LE 2026-08-03. Un scenario chacun, et ce n est
    // pas du zele : les trois formes de hatching ont vecu une journee entiere
    // livrees et verrouillees PAR RIEN, parce que le scenario tournait au
    // defaut et ne traversait aucune des autres branches. Une branche de
    // ditherThreshold qui rendrait la meme chose qu une autre compilerait, ses
    // parametres seraient cables, et rien ne le dirait.
    //
    // Tout est identique par ailleurs — meme mire, meme taille, memes deux
    // niveaux, memes encres — donc ce qui separe chaque image de la precedente
    // ne peut venir que du motif. Chacune se compare a la PRECEDENTE et non a la
    // mire nue : c est la chaine qui prouve que les six sont six.
    ...Object.fromEntries([
      ["effet-dither-bayer-fin", 3, "effet-dither"],
      ["effet-dither-bruit-blanc", 4, "effet-dither-bayer-fin"],
      ["effet-dither-lignes", 5, "effet-dither-bruit-blanc"],
      ["effet-dither-points", 6, "effet-dither-lignes"],
    ].map(([nom, style, contre]) => [nom, {
      contre,
      valeurs: 2,
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("dither", p);
        stack.updateParams(a, {
          style, size: 4, levels: 2, mono: 1,
          blackPoint: 0, whitePoint: 1, distribution: 1, amount: 1,
          inkHue: 0, inkSaturation: 0, inkLightness: 0,
          paperHue: 0, paperSaturation: 0, paperLightness: 1,
        });
      },
    }])),

    // OUTLINES, MODE ECHOS DE LA FORME — celui que la fiche de reference decrit
    // sous le nom Outlines : « a series of evenly spaced outlines that echo your
    // shape outward, like ripples ».
    //
    // CE SCENARIO A CHANGE D EFFET SANS CHANGER D IMAGE, le 2026-08-03 : il
    // portait echoOutlines, il porte outlines en mode 2 depuis l absorption
    // (ADR-0015). Les parametres ont ete transposes un a un et l image est
    // sortie identique a l octet — git a d ailleurs detecte le renommage du
    // fichier de reference a 100 %. C est ca, la preuve qu une fusion ne perd
    // rien : pas « ca se ressemble », mais « aucun canal n a bouge ».
    //
    // PAS DE BACKTICK DANS CE BLOC, jamais : tout ce fichier de scenarios est
    // injecte dans la page via un template literal, et un backtick de
    // commentaire le FERME. Meme piege exactement que dans un corps wgsl, et il
    // a ete retrouve ici le jour de cette absorption. L erreur rendue designe
    // une ligne sans rapport (SyntaxError sur l identifiant qui suit).
    //
    // LA MIRE COMMUNE, et pour son DISQUE. Cet effet ne mesure pas un gradient
    // mais une DISTANCE a une forme : il lui faut donc une forme assez GRANDE
    // pour survivre au lissage. Le disque en hautes lumieres de la mire commune
    // en est une, franche et a frontiere courbe — donc des anneaux comptables,
    // et une courbure qui distingue de vrais echos equidistants de simples
    // lignes de niveau (celles-ci se resserreraient dans les concavites).
    //
    // PREMIER ESSAI ECARTE, garde parce qu il se redecouvrirait : pose sur la
    // mire a POINTS LUMINEUX ISOLES — apparemment le sujet ideal d un effet de
    // silhouette — il a rendu UNE SEULE valeur et le garde de signal a refuse
    // d ecrire la reference. La raison est la limite n 2 ecrite en tete de l
    // effet : un point de quelques pixels floute sur ~212 px ne fait jamais
    // monter le champ jusqu au seuil, donc il n y a plus aucune forme. Une
    // forme plus fine que le lissage disparait, et c est le comportement voulu
    // — c est lui qui empeche le grain d engendrer des milliers d anneaux.
    //
    // Fond EFFACE en entier (wash 1) : ce qu on verifie ici est la GEOMETRIE
    // des anneaux, et la photo dessous ne ferait que la masquer.
    "effet-outlines-echos": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("outlines");
        stack.updateParams(a, {
          detectMode: 2,
          threshold: 0.5, inputSource: 0, smoothing: 1.5,
          spacing: 18, thickness: 3, echoCount: 5, falloff: 0,
          inkHue: 210, inkSaturation: 0, inkLightness: 0,
          endHue: 210, endSaturation: 0, endLightness: 0,
          wash: 1, backgroundHue: 0, backgroundSaturation: 0, backgroundLightness: 1,
          fill: 0,
        });
      },
    },

    // OUTLINES SUR UNE MIRE BRUITEE — pose le 2026-08-03 apres un signalement
    // d Antoine (« outlines semble bugge, l effet n est pas tres raffine »).
    //
    // CE QUE CETTE MIRE PEUT MONTRER, et que le damier ne peut pas : elle a des
    // aplats BRUITES (+-3 %) et deux marches franches. Un detecteur de contours
    // doit tracer les marches et NE RIEN tracer sur les aplats. Le damier, lui,
    // n a aucun aplat bruite — donc aucun endroit ou l effet puisse se tromper,
    // et c est pour ca qu il donnait un verrou vert sur un effet juge
    // inutilisable a l usage.
    //
    // Seuil VOLONTAIREMENT BAS (0,04) : c est le regime ou l on cherche a
    // dessiner les contours faibles d une photo, donc celui ou le defaut se
    // manifeste. A seuil haut, l effet ne trace presque rien et la question ne
    // se pose plus.
    "effet-outlines-bruit": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const bruit = await mireBruit(W, H);
        const sourceId = await r.photoSources.register(bruit);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bruit");
        const a = stack.addLayer("outlines", p);
        stack.updateParams(a, {
          thickness: 2.5, threshold: 0.04, softness: 0.35, chroma: 0,
          inkHue: 210, inkSaturation: 0, inkLightness: 0, wash: 1,
          inputSource: 0,
        });
      },
    },

    // LE SEUIL DE FORME (2026-08-03), le second mode de detection. Verrouille le
    // JOUR de sa livraison, et pas la semaine suivante : c est exactement la
    // configuration qui a coute cher a hatching — trois formes livrees,
    // compilant, aux parametres cables, et verrouillees par RIEN pendant seize
    // heures parce que le scenario existant tournait au defaut.
    //
    // Sur la mire commune, et c est elle qui decide : son disque en hautes
    // lumieres (250, 242, 208) est un CONTOUR FERME et le seul objet de la mire
    // qui se separe par un seuil de ton. Seuil a 0,80, au-dessus du damier clair
    // (224) et sous le disque : la silhouette tracee est donc celle du disque, et
    // rien d autre. Un seuil plus bas attraperait le damier et rendrait un
    // grillage, ce qui ne montrerait pas ce que ce mode pretend faire.
    //
    // Remplissage a 0,55 : ce n est pas un ornement, c est l operation
    // ASYMETRIQUE de l effet — la seule qui distingue l interieur de
    // l exterieur, donc la seule qui rende « Luminance inversee » porteuse. Le
    // scenario suivant le prouve en inversant.
    "effet-outlines-seuil-de-forme": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("outlines");
        stack.updateParams(a, {
          detectMode: 1, threshold: 0.8, thickness: 3, softness: 0.2,
          inkHue: 350, inkSaturation: 0.7, inkLightness: 0.35,
          fill: 0.55, wash: 0.7, inputSource: 0,
        });
      },
    },

    // LE MEME, EN LUMINANCE INVERSEE — et ce scenario EST la preuve, pas une
    // illustration.
    //
    // L entree inversee avait ete ECARTEE SUR PREUVE le 2026-08-01 : outlines
    // mesurait un gradient, et |grad(1-x)| = |grad(x)|, donc le controle aurait
    // ete inerte. La preuve reste juste pour la crete ; elle ne dit rien du seuil
    // de forme. Mais sur un trace de frontiere SEUL, inverser reviendrait a
    // chercher l isoligne au niveau 1 - seuil : le controle serait alors
    // REDONDANT avec le curseur de seuil, ce qui n est guere mieux qu inerte.
    //
    // C est le REMPLISSAGE qui tranche, et cette paire de references le mesure :
    // memes reglages au bit pres, seule l entree change, et ce qui bascule est
    // QUEL COTE est peint. Aucun reglage du seuil ne produit cette image-la.
    // Si quelqu un retirait le remplissage, les deux scenarios se rejoindraient
    // et le \`contre\` rougirait — c est-a-dire que le verrou tomberait sur la
    // JUSTIFICATION du controle, et pas seulement sur son cablage.
    "effet-outlines-seuil-de-forme-inverse": {
      contre: "effet-outlines-seuil-de-forme",
      build: async (r, stack) => {
        const a = stack.addLayer("outlines");
        stack.updateParams(a, {
          detectMode: 1, threshold: 0.8, thickness: 3, softness: 0.2,
          inkHue: 350, inkSaturation: 0.7, inkLightness: 0.35,
          fill: 0.55, wash: 0.7, inputSource: 2,
        });
      },
    },

    // LES TROIS FORMES DE TAILLE, verrouillees le 2026-08-02 — et elles ne l
    // etaient PAS, alors qu elles sont livrees depuis le 2026-08-01 (0574caf).
    // Le scenario effet-hatching ci-dessus tourne en Droites, c est-a-dire au
    // defaut : il ne traverse aucune des trois branches de hatch_coord. Elles
    // compilaient (npm run test:gpu-shaders) et leurs parametres etaient cables
    // (parametresCables), ce qui ne dit rien du rendu — meme configuration
    // exacte que lensBlur, qui avait dix-sept tests verts en floutant au double
    // du rayon regle.
    //
    // MEME MIRE que effet-hatching (la rampe) et memes reglages de trame, a la
    // forme pres : ce qui separe ces images de la premiere est donc la forme et
    // rien d autre. Chacune se compare a la version Droites, pas a la mire nue.
    //
    // AMPLITUDE VOLONTAIREMENT GRANDE (24 px pour un espacement de 9) : sous
    // l espacement, une ondulation ne deplace la taille que d une fraction d
    // interligne et se confondrait avec du bruit. Il faut que l onde traverse
    // plusieurs interlignes pour qu une erreur de phase se voie.
    "effet-hatching-ondulations": {
      contre: "effet-hatching",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("hatching", p);
        stack.updateParams(a, {
          angle: 45, spacing: 9, weight: 0.62, crossAngle: 65, layers: 3,
          blackPoint: 0.05, whitePoint: 0.95, wash: 0,
          pattern: 1, waveAmplitude: 24, waveFrequency: 6,
        });
      },
    },

    // ZIGZAG : meme onde, meme amplitude, meme frequence — seule la FORME de l
    // onde change (triangulaire au lieu de sinusoidale). C est la paire qui rend
    // les deux distinguables ; si les deux branches rendaient la meme image, ce
    // couple de references le dirait, et aucun test unitaire ne le pourrait.
    "effet-hatching-zigzag": {
      contre: "effet-hatching-ondulations",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("hatching", p);
        stack.updateParams(a, {
          angle: 45, spacing: 9, weight: 0.62, crossAngle: 65, layers: 3,
          blackPoint: 0.05, whitePoint: 0.95, wash: 0,
          pattern: 2, waveAmplitude: 24, waveFrequency: 6,
        });
      },
    },

    // CERCLES : la seule forme dont la phase n est pas une projection sur une
    // direction, donc la seule ou l angle et le croisement n ont plus d objet.
    // Centre decale hors du milieu (0.35, 0.4) expres : centre, les anneaux
    // seraient symetriques sur les deux axes et une inversion de x et y passerait
    // inapercue.
    "effet-hatching-cercles": {
      contre: "effet-hatching",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("hatching", p);
        stack.updateParams(a, {
          angle: 45, spacing: 9, weight: 0.62, crossAngle: 65, layers: 3,
          blackPoint: 0.05, whitePoint: 0.95, wash: 0,
          pattern: 3, centerX: 0.35, centerY: 0.4,
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
    //
    // PORTE DE \`coloredEdges\` VERS \`outlines\` le 2026-08-03, quand le premier a
    // ete absorbe par le second (mode d encre). Les reglages sont TRANSPOSES et
    // non rejoues : \`saturation\` devient \`wheelChroma\`, \`lightness\` devient
    // \`wheelLightness\`, et \`inkMode\` passe a la Roue. Tout le reste est
    // identique au chiffre pres, et c est le point du geste — l image doit
    // ressortir a l OCTET, sans quoi la fusion aurait perdu quelque chose. Elle
    // est ressortie a l octet.
    "effet-outlines-roue": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("outlines");
        stack.updateParams(a, {
          thickness: 2, threshold: 0.07, softness: 0.3, chroma: 0.5,
          inkMode: 1, hueOffset: 0, hueSpread: 1,
          wheelChroma: 0.85, wheelLightness: 0.55,
          wash: 0.85, inputSource: 0,
        });
      },
    },

    // LE MEME, AU CALQUE POSE, pose le 2026-08-02 avec la refonte OKLCH.
    // Le scenario ci-dessus tourne a chroma 0,85 et wash 0,85, c est-a-dire bien
    // au-dela de ce que donne le calque pose : il est fait pour EXAGERER la roue,
    // ce qui est ce qu il faut pour la mesurer, et pas du tout ce qu il faut pour
    // juger l effet. Les deux questions sont distinctes et meritent deux images —
    // le verdict « horrible, inutilisable » portait, lui, sur le calque pose.
    //
    // ⚠️ IL LISAIT LES DEFAUTS DE \`coloredEdges\`, QUI N EXISTENT PLUS. Depuis la
    // fusion les defauts sont ceux d \`outlines\`, donc ce scenario doit ECRIRE les
    // anciens s il veut verrouiller la meme image. Ils sont recopies ci-dessous
    // tels qu ils etaient, et c est la seule facon de garder comparable un
    // scenario dont le sujet est « ce que l effet donne quand on le pose ».
    "effet-outlines-roue-calque-pose": {
      contre: "effet-outlines-roue",
      build: async (r, stack) => {
        const a = stack.addLayer("outlines");
        stack.updateParams(a, {
          thickness: 2, threshold: 0.07, softness: 0.3, chroma: 0.5,
          inkMode: 1, hueOffset: 0, hueSpread: 1,
          wheelChroma: 0.42, wheelLightness: 0.62,
          wash: 0.45, inputSource: 0,
          backgroundHue: 0, backgroundSaturation: 0, backgroundLightness: 1,
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

    // \`effet-surface-blur\` a occupe cette place du 2026-08-02 au 2026-08-03, sur
    // \`mireBruit\`. L effet est sorti du registre (ADR-0011) et son scenario avec
    // lui. \`mireBruit\` RESTE : elle sert aussi a \`effet-outlines-bruit\`, et ses
    // deux aplats bruites separes par un contour franc sont la seule mire qui
    // puisse dire d un operateur local s il preserve ce qu il pretend preserver.
    //
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

    // TEXTURE, l effet qui echantillonne un SCAN. Sa propriete distinctive n est
    // pas d assombrir ou d eclaircir — c est de poser une image EXTERIEURE et de
    // la transformer. Une mire ne peut le montrer que si la texture porte des
    // structures reconnaissables : d ou la mire generee mireEncre (plus haut
    // dans ce fichier), qui superpose des cellules de 32 px, des bandes
    // diagonales et du detail au texel.
    //
    // La ROTATION est reglee a 31 degres et le decalage non nul EXPRES : a
    // rotation nulle et decalage nul, un bug qui ignorerait ces deux parametres
    // rendrait exactement les memes pixels, et le verrou ne dirait rien d eux.
    // C est la lecon de lensBlur (2026-08-01) — une reference posee sur un cas
    // degenere verrouille du bruit.
    "effet-texture": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        r.setTextureCatalog([TEXTURE_MIRE]);
        // ATTENDRE le decodage : viewFor ne bloque pas, il sert le repli 1x1
        // et rend la main. Sans cette attente, la frame partirait sans la
        // texture — c est exactement ce que le garde de signal a attrape.
        await r.ensureTextureLoaded(0);
        const a = stack.addLayer("texture");
        stack.updateParams(a, {
          rang: 0, echelle: 0.6, rotation: 31, decalageX: 0.17, decalageY: -0.09,
          inversion: 0, desaturation: 0, contraste: 1, pivot: 0.5,
        });
        // Incrustation a 0,7 : les defauts que l effet pose lui-meme. Le
        // scenario verrouille donc AUSSI le fait que ces defauts existent.
        const calque = stack.layers.find((l) => l.id === a);
        if (calque) { calque.blendMode = "overlay"; calque.opacity = 0.7; }
      },
    },

    // TEXTURE, POSEE DANS UNE BOITE (2026-08-27, ticket 21). Il CONTRE
    // effet-texture, donc l ecart mesure est exactement ce que la boite ajoute :
    // le bornage du trace, et le re-ancrage du motif sur le centre et l angle de
    // la boite. A ses defauts (centre 0,5 / 0,5, taille 1 x 1, angle 0) la boite
    // est l identite au bit pres — c est effet-texture lui-meme qui verrouille
    // ce cas, et il ne doit PAS bouger.
    //
    // TROIS DEGENERESCENCES EVITEES ENSEMBLE, et c est la lecon de lensBlur
    // (2026-08-01, une reference posee sur un cas degenere verrouille du bruit) :
    // la boite est DECENTREE (un bug qui ignorerait son centre rendrait la meme
    // image qu une boite centree), PLUS PETITE que le cadre (sinon rien n est
    // borne et la couverture vaut 1 partout), et TOURNEE (sinon les deux termes
    // croises de la rotation isotrope restent nuls et ne sont jamais eprouves).
    //
    // CE QU IL VERROUILLE AUSSI, et qui se lit mal sur l image : hors de la
    // boite, l effet rend son entree telle quelle, mais le calque est en
    // Incrustation a 0,7 et overlay(c, c) n est pas l identite. Le fond hors
    // boite est donc CONTRASTE, pas intact. C est le comportement reel de l app
    // — un effet ne peut pas neutraliser son propre mode de fusion — et le
    // verrouiller ici evite qu il change sans qu on le decide.
    "effet-texture-box": {
      contre: "effet-texture",
      build: async (r, stack) => {
        r.setTextureCatalog([TEXTURE_MIRE]);
        // ATTENDRE le decodage : viewFor ne bloque pas, il sert le repli 1x1
        // et rend la main.
        await r.ensureTextureLoaded(0);
        const a = stack.addLayer("texture");
        stack.updateParams(a, {
          rang: 0, echelle: 0.6, rotation: 31, decalageX: 0.17, decalageY: -0.09,
          inversion: 0, desaturation: 0, contraste: 1, pivot: 0.5,
          boiteX: 0.38, boiteY: 0.56, boiteLargeur: 0.5, boiteHauteur: 0.35, boiteRotation: 24,
        });
        // Memes fusion et opacite que effet-texture : sans elles, le contre
        // mesurerait le changement de melange en plus de celui de la boite.
        const calque = stack.layers.find((l) => l.id === a);
        if (calque) { calque.blendMode = "overlay"; calque.opacity = 0.7; }
      },
    },

    // TEXTURE, LEVELS POUSSES — SCENARIO RETIRE LE 2026-08-05, ET LA RAISON
    // VAUT D ETRE LUE PLUTOT QUE CONTOURNEE.
    //
    // Il reglait contraste 9 / pivot 0,42 et le harnais a refuse sa reference :
    // 184668 canaux sur 196608 differaient entre DEUX RENDUS DE LA MEME PASSE,
    // systematiquement, jamais aleatoirement. Le meme scenario a contraste 1
    // (effet-texture) est parfaitement reproductible.
    //
    // Donc l instabilite n est PAS dans les Levels : ils AMPLIFIENT par 9 un
    // ecart sub-LSB qui existe deja dans la voie de televersement de la texture,
    // et que contraste 1 laisse sous le seuil de quantification. Baisser le gain
    // pour faire passer le scenario aurait cache le defaut au lieu de le
    // trouver — exactement ce que le garde de signal existe pour empecher.
    //
    // A CHASSER SEPAREMENT : d ou vient cet ecart entre deux rendus consecutifs
    // avec la meme texture residente. Piste la plus probable, non verifiee :
    // createImageBitmap depuis un ImageData applique une conversion (premultiplie
    // ou espace colorimetrique) dont le resultat n est pas bit-a-bit stable
    // d un appel a l autre.

    // BAVURE D ENCRE sur la trame. Il CONTRE effet-halftone, donc l ecart
    // mesure est exactement ce que la bavure ajoute — pas la trame elle-meme.
    //
    // Ce scenario est le seul qui verrouille quelque chose de l encre : celui de
    // effet-halftone la laisse a zero, ou elle est un no-op par construction.
    // Un verrou pose uniquement sur le defaut aurait l air de couvrir la
    // fonctionnalite sans rien en dire.
    "effet-halftone-encre": {
      contre: "effet-halftone",
      build: async (r, stack) => {
        r.setTextureCatalog([TEXTURE_MIRE]);
        // ATTENDRE le decodage : viewFor ne bloque pas, il sert le repli 1x1
        // et rend la main. Sans cette attente, la frame partirait sans la
        // texture — c est exactement ce que le garde de signal a attrape.
        await r.ensureTextureLoaded(0);
        const a = stack.addLayer("halftone");
        stack.updateParams(a, {
          dotSize: 10, dotScale: 1.05, colorMode: 0, rotation: 0,
          centerX: 0.5, centerY: 0.5, softness: 0.12, blackPoint: 0, whitePoint: 1,
          encreRang: 0, encreForce: 0.8, encreEchelle: 0.35,
        });
      },
    },

    // CHANNEL MIXER, A SES DEFAUTS — et ce scenario est pose le 2026-08-02
    // AVANT de toucher a l effet, pas apres. L effet n avait alors NI test
    // unitaire NI reference : rien ne pouvait dire si l ajout des encres le
    // laissait intact a son defaut. Meme geste que pour outlines avant l
    // extraction de son gradient — poser la preuve avant le geste.
    //
    // La mire commune convient sans reserve ici : un channel mixer est une
    // recombinaison LINEAIRE des canaux, donc ce qu il faut lui montrer, ce
    // sont des couleurs saturees et variees. Le damier teinte en donne sur
    // toute la roue, et les aplats du disque donnent le cas neutre.
    "effet-channel-mixer": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        stack.addLayer("channelMixer");
        // AUCUN updateParams : c est le point du scenario. Il verrouille les
        // DEFAUTS, donc exactement ce qu on voit en posant le calque.
      },
    },

    // LE MEME EFFET, ENCRES ENGAGEES — la recoloration par canal du cahier
    // (§6quinquies : « Channel mixer takes the red, green, and blue colors in
    // an image and recolors each channel with your own selected color »).
    //
    // CE QUE CETTE REFERENCE PEUT MONTRER, et que la precedente ne peut pas :
    // les trois encres sont posees sur des teintes ECARTEES (orange, vert,
    // turquoise), donc un canal qui partirait dans la mauvaise colonne se
    // verrait comme un virage de teinte franc. La matrice est laissee a l
    // identite pour que ce qu on lit vienne des encres SEULES.
    "effet-channel-mixer-encres": {
      contre: "effet-channel-mixer",
      build: async (r, stack) => {
        const a = stack.addLayer("channelMixer");
        stack.updateParams(a, {
          redFromRed: 1, redFromGreen: 0, redFromBlue: 0,
          greenFromRed: 0, greenFromGreen: 1, greenFromBlue: 0,
          blueFromRed: 0, blueFromGreen: 0, blueFromBlue: 1,
          preserveLuma: 1, monochrome: 0,
          colorize: 1,
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
    // PORTE DE \`anamorphicStreak\` VERS \`lensDistortion\` le 2026-08-03 (ADR-0014),
    // reglages transposes a l identique : la trainee est le meme code, seuls ses
    // index de parametres ont bouge. Geometrie et aberration a ZERO ici — ce
    // scenario verrouille la trainee et rien d autre.
    "effet-lens-distortion-trainee": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "points");
        const a = stack.addLayer("lensDistortion", p);
        stack.updateParams(a, {
          distortion: 0, zoom: 1, aberration: 0,
          streakThreshold: 0.5, streakLength: 70, streakIntensity: 1.4, streakAngle: 0,
          streakTintHue: 210, streakTintSaturation: 0.8, streakTintLightness: 0.6,
          streakDispersion: 0.25,
        });
      },
    },

    // LE FISHEYE, SEUL — et sur la mire COMMUNE, dont le damier a pas regulier
    // est le seul motif qui rende une deformation radiale mesurable a l oeil :
    // des cases qui grossissent du centre vers les bords, ce qu aucun degrade ni
    // aucun point isole ne pourrait montrer.
    //
    // Trainee a ZERO, qui est son defaut : ce scenario verifie donc AUSSI que les
    // quatre passes internes ne tournent pas. Si elles tournaient et que
    // \`prevPass\` portait la source (ce qu il porte quand elles sautent), l image
    // sortirait avec la photo ajoutee en double — le produit par l intensite
    // nulle est ce qui l en empeche, et cette reference le fige.
    "effet-lens-distortion-fisheye": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("lensDistortion");
        stack.updateParams(a, { distortion: 0.55, zoom: 1.18, aberration: 0, streakIntensity: 0 });
      },
    },

    // LES TROIS MODES D ABERRATION, sur la meme mire et a la meme force. Aucun ne
    // se deduit d un autre, et les trois references le prouvent par leurs ecarts
    // mutuels : la laterale est nulle au centre, la longitudinale se voit
    // PARTOUT (c est une mise au point, pas un deplacement), l anamorphique ne
    // deplace que sur l horizontale et ne croit pas avec le rayon.
    //
    // Distorsion a zero dans les trois : on isole l aberration de la geometrie,
    // sinon on ne saurait pas laquelle des deux a bouge un pixel.
    "effet-lens-distortion-laterale": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("lensDistortion");
        stack.updateParams(a, {
          distortion: 0, aberration: 0.06, aberrationMode: 0,
          centerFalloff: 2, centerPresence: 0.1, asymmetry: 0.4, streakIntensity: 0,
        });
      },
    },

    "effet-lens-distortion-longitudinale": {
      contre: "effet-lens-distortion-laterale",
      build: async (r, stack) => {
        const a = stack.addLayer("lensDistortion");
        stack.updateParams(a, {
          distortion: 0, aberration: 0.06, aberrationMode: 1,
          centerFalloff: 2, centerPresence: 0.1, asymmetry: 0.4, streakIntensity: 0,
        });
      },
    },

    "effet-lens-distortion-anamorphique": {
      contre: "effet-lens-distortion-laterale",
      build: async (r, stack) => {
        const a = stack.addLayer("lensDistortion");
        stack.updateParams(a, {
          distortion: 0, aberration: 0.06, aberrationMode: 2,
          centerFalloff: 2, centerPresence: 0.1, asymmetry: 0.4, streakIntensity: 0,
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
    // d Antoine : « tres aliase effet metal avec des artefacts, c est le but ? »
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

    // MOTION BLUR, TRAINEE LONGUE — le scenario qui verifie les DEUX etages de
    // collecte, poses le 2026-08-02 quand la plage est passee de 120 a 2000 px.
    //
    // Rotation a 360 degres, et ce choix est TOUT le test : integrer un tour
    // complet, c est prendre la moyenne autour de chaque cercle. Le resultat
    // exact est donc fait d anneaux PARFAITEMENT CONSTANTS, et cette verite est
    // analytique — elle ne depend d aucune implementation, donc rien ne peut la
    // rendre complaisante. Toute variation residuelle le long d un cercle EST le
    // fantome, par definition.
    //
    // A ce reglage, la trainee atteint ~800 px sur les bords (rayon 128 x 2pi),
    // soit ~400 texels de demi-resolution : le decoupage vaut TROIS segments, et
    // le second etage est donc reellement exerce. Sous 384 px il ne le serait
    // pas, et la reference ne verrouillerait que le chemin d avant.
    "effet-motion-blur-long": {
      contre: "effet-motion-blur",
      build: async (r, stack) => {
        const a = stack.addLayer("motionBlur");
        stack.updateParams(a, {
          trajectory: 1, amount: 360, angle: 0,
          centerX: 0.5, centerY: 0.5, bias: 0, falloff: 0,
        });
      },
    },

    // POSTERIZE EN SERIGRAPHIE — les quatre controles ajoutes le 2026-08-02 sur
    // un retour d Antoine (« posterize a tres peu de controles » : il en avait
    // UN). Le scenario les met tous les quatre HORS de leur defaut, sans quoi la
    // reference ne verrouillerait que le chemin d avant.
    //
    // TRAMAGE A ZERO, et c est le reglage qui compte. Le dither existe pour
    // casser la bande sur un degrade doux ; un aplat d affiche veut au contraire
    // la frontiere FRANCHE, et l effet ne savait pas la faire. La propriete se
    // mesure sur la LONGUEUR DES PLAGES le long d une ligne : sans tramage, de
    // longues plages constantes ; avec, elles sont hachees en motif fin. Ce n est
    // PAS le nombre de couleurs qui distingue les deux — le dither decale avant
    // de quantifier, donc la sortie n a de toute facon que \`levels\` valeurs par
    // canal.
    //
    // Repartition PERCEPTUELLE : l autre moitie du retour, et une question que
    // le cahier laissait explicitement ouverte au paragraphe 5.
    // Compte de valeurs DECLARE au lieu du plancher generique, et ce n est pas
    // un contournement : 4 paliers par canal ne peuvent produire que 4³ = 64
    // couleurs au plus, et la mire n en exerce que 32. Le plancher de 64 protege
    // contre une image MORTE ; ici l image est vivante et volontairement pauvre,
    // c est la propriete meme de l effet. Declarer le compte exact est plus fort
    // que le plancher — il verrouille que l effet quantifie REELLEMENT, ce
    // qu un plancher ne saurait pas dire. Meme idiome que la toile vide, qui
    // declare 1.
    //
    // PORTE DE \`posterize\` VERS \`dither\` le 2026-08-03, quand le premier est
    // sorti du registre (ADR-0012). Le scenario est le meme mot pour mot : c est
    // le rendu serigraphie, et c est precisement la propriete qui justifiait de
    // dire que dither est un surensemble. La porter ici, c est la rendre
    // opposable plutot que declarative.
    "effet-dither-serigraphie": {
      contre: "photo-de-fond-seule",
      valeurs: 32,
      build: async (r, stack) => {
        const a = stack.addLayer("dither");
        stack.updateParams(a, {
          levels: 4, amount: 0, mono: 0, blackPoint: 0.1, whitePoint: 0.9, distribution: 1,
        });
      },
    },

    // MOTION BLUR DIRECTIONNEL — et ce scenario comble un trou releve le
    // 2026-08-02 par Antoine (« le motion blur ne semble rien faire ») : les
    // DEUX scenarios existants sont en Rotation. Le mode DIRECTIONNEL, qui est
    // le defaut de l effet et donc celui qu on essaie en premier, n avait aucun
    // verrou. Un refactor pouvait le casser sans faire rougir quoi que ce soit.
    //
    // Amplitude 60 px : au-dessus du seuil de reprise du net, en dessous du
    // decoupage en segments (192 px). Il verrouille donc le chemin a UN segment,
    // celui de tous les reglages courants.
    "effet-motion-blur-directionnel": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("motionBlur");
        stack.updateParams(a, {
          trajectory: 0, amount: 60, angle: 30,
          centerX: 0.5, centerY: 0.5, bias: 0, falloff: 0.35,
        });
      },
    },

    // HALATION — son PREMIER verrou, pose le 2026-08-03. L effet n en avait
    // aucun : ni scenario dedie, ni meme un passage dans un scenario de
    // composition. Neuf passes de pyramide et un composite recolorisant
    // pouvaient donc changer sans faire rougir quoi que ce soit.
    //
    // Seuil a 0.70, et ce n est pas un reglage de gout : il tombe au-dessus du
    // fond clair de la mire (160, soit 0.63 en perceptuel) et tres en dessous des
    // quatre sources, qui saturent chacune un canal. C est ce qui garantit que
    // les SEULS emetteurs de l image sont les huit disques — un fond qui halate
    // noierait la mesure qu on vient chercher.
    //
    // Portee au MINIMUM (0.3, soit un rayon d environ 48 px) pour que les halos
    // de la colonne sombre n atteignent pas la moitie claire : la comparaison
    // fond sombre / fond clair EST le sujet du scenario, et elle ne vaut que si
    // les deux moities restent independantes.
    //
    // Effacement sur fond clair laisse a son defaut (0.6) : c est le terme
    // mesure. A ce reglage le poids vaut 0.97 a gauche contre 0.62 a droite, donc
    // des sources identiques doivent rendre des halos visiblement inegaux — et
    // si quelqu un retirait le terme, les huit halos deviendraient egaux.
    "effet-halation": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const lampes = await mireLampes(W, H);
        const sourceId = await r.photoSources.register(lampes);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "lampes");
        const a = stack.addLayer("halation", p);
        stack.updateParams(a, {
          threshold: 0.7, spread: 0.3, intensity: 4,
          hue: 0.7, transition: 8, background: 0.6,
        });
      },
    },

    // LE MEME, SANS L EFFACEMENT — et ce scenario existe parce que le precedent
    // seul serait AVEUGLE au parametre qu il pretend temoigner.
    //
    // Sur la reference ci-dessus, la moitie claire ne porte aucun halo visible.
    // C est la bonne image, mais elle ne prouve pas sa cause : un halo rouge
    // AJOUTE a un gris moyen est de toute facon peu perceptible, donc on ne peut
    // pas distinguer « le terme de fond l a efface » de « l addition ne se voyait
    // pas ». Quelqu un pourrait retirer \`poidsFond\` du composite sans faire
    // bouger grand-chose, et le verrou laisserait passer.
    //
    // Le temoin le rend impossible : meme mire, memes sources, effacement a 0.
    // L ecart entre les deux references EST la contribution du terme, et il vaut
    // 20,4 % des canaux — s il disparaissait, les deux scenarios convergeraient
    // et le \`contre\` rougirait.
    //
    // ⚠️ A l oeil la difference est SUBTILE : la moitie claire du temoin vire au
    // rose-chaud, celle de la reference reste grise, et c est tout. Elle est donc
    // MESUREE plus que montree, et le dire vaut mieux que laisser croire que
    // l image saute aux yeux. C est aussi pourquoi l intensite est poussee a son
    // maximum (4) dans les deux scenarios : a 1,6 l ecart existait toujours
    // (14,8 %) mais les deux images etaient rigoureusement indiscernables, et une
    // reference qu on ne peut pas relire avant de la committer ne remplit que la
    // moitie de son office.
    "effet-halation-fond-clair": {
      contre: "effet-halation",
      build: async (r, stack) => {
        const lampes = await mireLampes(W, H);
        const sourceId = await r.photoSources.register(lampes);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "lampes");
        const a = stack.addLayer("halation", p);
        stack.updateParams(a, {
          threshold: 0.7, spread: 0.3, intensity: 4,
          hue: 0.7, transition: 8, background: 0,
        });
      },
    },

    // CHROMATIC BLEED, RADIAL — son premier verrou dedie. L effet passait bien
    // dans \`photo-double-exposure\`, mais en PASSAGER : ce scenario est bati pour
    // montrer une composition a deux photos, et l aberration n y est que ce qui
    // rend la chose visible. Un verrou qui ne sait pas nommer ce qu il casse ne
    // verrouille rien.
    //
    // Presence au centre a 0.1 (defaut 0.35) : c est le reglage qui rend la
    // CROISSANCE lisible. A 0.35 le centre porte deja un tiers du decalage des
    // coins et la progression se lit mal ; a 0.1 le centre est presque propre, et
    // toute la promesse de \`centerFalloff\` devient une comparaison directe entre
    // le milieu de l image et ses coins, sur un damier identique partout.
    //
    // Asymetrie a 0.4 (defaut 0.15) : le rouge et le bleu doivent parcourir des
    // distances DIFFERENTES. A l equilibre les deux franges seraient
    // symetriques et un bug qui echangerait les deux courses ne se verrait pas.
    //
    // CE SCENARIO A CHANGE D EFFET le 2026-08-03 : il portait chromaticBleed,
    // absorbe depuis par le mode Laterale de lensDistortion (ADR-0016). A la
    // difference des quatre absorptions precedentes, celle-ci n est PAS
    // identique a l octet — les deux implementations etaient independantes. Elle
    // a ete mesuree avant le geste, sur cette mire et a ces reglages : 0,005 %
    // des canaux d ecart, soit une dizaine sur 196 608. La reference a donc ete
    // regeneree, et ce chiffre est la seule chose qui autorise a dire que rien
    // n a ete perdu.
    "effet-lens-distortion-laterale-damier": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const damier = await mireDamierNeutre(W, H);
        const sourceId = await r.photoSources.register(damier);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "damier");
        const a = stack.addLayer("lensDistortion", p);
        stack.updateParams(a, {
          distortion: 0, aberration: 0.06, aberrationMode: 0,
          centerFalloff: 2, centerPresence: 0.1, asymmetry: 0.4,
          aberrationAngle: 0, streakIntensity: 0,
        });
      },
    },

    // LE MEME, EN TANGENTIEL. L orientation n est pas un reglage de plus : a 45
    // degres le decalage n est plus radial mais perpendiculaire au rayon
    // (decentrement d objectif), donc les franges tournent AUTOUR du centre au
    // lieu d en partir. C est une seconde geometrie, et elle merite son verrou
    // pour la meme raison que les geometries de champ de lensBlur ont le leur.
    //
    // \`contre\` pointe sur le scenario radial et non sur la photo nue : ce qu on
    // veut asserter n est pas « l effet fait quelque chose » (deja acquis) mais
    // « les deux orientations ne rendent pas la meme image ».
    //
    // C EST CE SCENARIO QUI A EMPECHE UN RETRAIT SEC. Mesure du 2026-08-03 : le
    // mode Laterale couvrait chromaticBleed a 0,005 % pres sur le cas radial,
    // mais cet ecart-ci vaut 23,1 % — un grandissement dependant de la longueur
    // d onde ne produit que du radial, par construction. L orientation a donc
    // ete PORTEE dans lensDistortion (aberrationAngle) avant que l effet parte.
    "effet-lens-distortion-laterale-decentree": {
      contre: "effet-lens-distortion-laterale-damier",
      build: async (r, stack) => {
        const damier = await mireDamierNeutre(W, H);
        const sourceId = await r.photoSources.register(damier);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "damier");
        const a = stack.addLayer("lensDistortion", p);
        stack.updateParams(a, {
          distortion: 0, aberration: 0.06, aberrationMode: 0,
          centerFalloff: 2, centerPresence: 0.1, asymmetry: 0.4,
          aberrationAngle: 45, streakIntensity: 0,
        });
      },
    },

    // ─── LENS FLARE (2026-08-03) ──────────────────────────────────────────
    //
    // TOUS SUR mireBokeh, et c est la seule mire du dossier qui convienne : un
    // flare part d une SOURCE PONCTUELLE FRANCHE sur du sombre. Sur la mire
    // commune, le damier clair passerait le seuil partout et la chaine de
    // fantomes se lirait comme un voile general — exactement le piege qui a
    // coute cher a lensBlur, dont le premier scenario etait pose sur une mire
    // sans point lumineux isole.
    //
    // QUATRE SCENARIOS, UN PAR CONTRIBUTION. Le premier isole les fantomes en
    // EXCLUANT la photo (seuil a 1) : ne reste que le lobe pose, donc la chaine
    // est sans ambiguite hexagonale. Les trois autres partent de lui et
    // n allument qu une chose de plus. C est le patron temoin de halation :
    // l ecart entre deux images EST la contribution du terme.
    "effet-lens-flare-source-posee": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bokeh");
        const a = stack.addLayer("lensFlare", p);
        stack.updateParams(a, {
          threshold: 1, spread: 1.2,
          sourceX: 0.16, sourceY: 0.14, sourceRadius: 0.09, sourceIntensity: 5,
          blades: 0, bladeRotation: 0,
          ghostCount: 5, ghostSpacing: 0.3, ghostIntensity: 1.2, ghostDispersion: 0.5,
          tintHue: 30, tintSaturation: 0.45, tintLightness: 0.6,
          haloIntensity: 0, haloRadius: 0.42, veil: 0, plume: 0, scatter: 0, arcs: 0,
        });
      },
    },

    // LA VOIE AUTOMATIQUE. Meme reglage, mais la source posee est ETEINTE et le
    // seuil descendu : le flare part alors des points lumineux de la photo.
    // \`contre\` pointe sur le scenario pose, parce que ce qu on veut asserter
    // n est pas « l effet fait quelque chose » mais « les deux voies ne rendent
    // pas la meme image ». Les fantomes y sont ronds et mous, et c est le prix
    // annonce : une haute lumiere reelle n a pas de forme de diaphragme connue.
    "effet-lens-flare-automatique": {
      contre: "effet-lens-flare-source-posee",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bokeh");
        const a = stack.addLayer("lensFlare", p);
        stack.updateParams(a, {
          threshold: 0.55, spread: 1.2,
          sourceIntensity: 0,
          blades: 0, bladeRotation: 0,
          ghostCount: 5, ghostSpacing: 0.3, ghostIntensity: 1.2, ghostDispersion: 0.5,
          tintHue: 30, tintSaturation: 0.45, tintLightness: 0.6,
          haloIntensity: 0, haloRadius: 0.42, veil: 0, plume: 0, scatter: 0, arcs: 0,
        });
      },
    },

    // L ANNEAU SEUL. Fantomes eteints, anneau seul allume. Ce que ce temoin
    // protege est sa POSITION : l anneau est centre sur le CENTRE DU CADRE et
    // non sur la source, parce qu il vient d une face spherique donc de l axe
    // optique. Le centrer sur la source en ferait un halo de diffusion, c est
    // a dire un glow deguise — et rien d autre qu une reference ne le dirait.
    "effet-lens-flare-anneau": {
      contre: "effet-lens-flare-source-posee",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bokeh");
        const a = stack.addLayer("lensFlare", p);
        stack.updateParams(a, {
          threshold: 1, spread: 1.2,
          sourceX: 0.16, sourceY: 0.14, sourceRadius: 0.09, sourceIntensity: 5,
          blades: 0, bladeRotation: 0,
          ghostCount: 0, ghostIntensity: 0,
          tintHue: 30, tintSaturation: 0.45, tintLightness: 0.6,
          haloIntensity: 0.7, haloRadius: 0.42, veil: 0, plume: 0, scatter: 0, arcs: 0,
        });
      },
    },

    // LE VOILE SEUL. Ce temoin protege la distinction qui separe cet effet d un
    // glow : le voile ajoute une lumiere SCALAIRE teintee, donc il remonte les
    // noirs SANS redessiner les formes. Un glow ajouterait la couleur locale et
    // ferait reapparaitre les points lumineux en plus gros. L image doit donc
    // etre lavee et plate, pas aureolee.
    "effet-lens-flare-voile": {
      contre: "effet-lens-flare-source-posee",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bokeh");
        const a = stack.addLayer("lensFlare", p);
        stack.updateParams(a, {
          threshold: 1, spread: 4,
          sourceX: 0.16, sourceY: 0.14, sourceRadius: 0.09, sourceIntensity: 5,
          blades: 0, ghostCount: 0, ghostIntensity: 0,
          tintHue: 30, tintSaturation: 0.45, tintLightness: 0.6,
          haloIntensity: 0, veil: 1.6, plume: 0, scatter: 0, arcs: 0,
        });
      },
    },

    // LA PLUME, ET C EST LE CŒUR DE L EFFET DEPUIS LA TROISIEME REVUE. Cinq
    // photographies d Antoine, prises avec son propre materiel, ne montraient NI
    // chapelet NI anneau — toutes la meme plume large, fortement teintee par le
    // revetement et coupee par un bord DROIT.
    //
    // Source AU-DESSUS du cadre (y = -0.12), comme sur ses images : le soleil
    // est hors champ et la plume descend dans l image. Fantomes et anneau
    // eteints pour que ce verrou ne porte que sur elle.
    //
    // Ce que la reference doit montrer, et qu aucun lobe rond ne sait faire :
    // un CONE qui s evase vers le bas, et une COUPE nette en travers.
    "effet-lens-flare-plume": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bokeh");
        const a = stack.addLayer("lensFlare", p);
        stack.updateParams(a, {
          threshold: 1, spread: 2,
          sourceX: 0.52, sourceY: -0.12, sourceRadius: 0.09, sourceIntensity: 5,
          ghostCount: 0, ghostIntensity: 0,
          tintHue: 262, tintSaturation: 0.62, tintLightness: 0.6,
          haloIntensity: 0, veil: 0.35, scatter: 0, scatterDetail: 70,
          sensor: 0, arcs: 0,
          plume: 1.4, plumeLength: 0.9, plumeSpread: 0.6, plumeEdge: 0.28,
        });
      },
    },

    // LES TROIS AUTRES FAMILLES, ET LE HORS CADRE. Question d Antoine a la
    // revue : « ca c est un flare quand le capteur regarde directement la
    // source, et pour les autres types ? ». Ce scenario est la reponse, et il
    // verrouille quatre choses d un coup :
    //
    //  · SOURCE HORS CADRE (x = 1.25). L anneau et le voile ne rendaient RIEN
    //    dans ce cas — le lobe etait rasterise dans la passe de seuillage, qui
    //    ne couvre que [0,1] — alors que le curseur va de -0.5 a 1.5 et que
    //    l infobulle le promet. Mesure avant correction : fantomes presents,
    //    voile a 1.6 absent. Ils sont analytiques depuis.
    //  · les STRIES de diffusion (objectif sale), 2e famille
    //  · le QUADRILLAGE capteur (red dot), 3e famille
    //  · les ARCS de barillet
    //
    // Aucun des quatre ne lit la moindre texture : si ce scenario rougissait
    // alors que les autres passent, c est la voie DESSINEE qui a bouge.
    "effet-lens-flare-familles": {
      contre: "effet-lens-flare-source-posee",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bokeh");
        const a = stack.addLayer("lensFlare", p);
        stack.updateParams(a, {
          threshold: 1, spread: 2,
          sourceX: 1.25, sourceY: 0.3, sourceRadius: 0.09, sourceIntensity: 5,
          // SIX LAMES ICI, ET NULLE PART AILLEURS. Le defaut est passe au
          // diaphragme CIRCULAIRE le 2026-08-03 (arbitrage d Antoine, « je n
          // aime pas les lames de diaphragme »), et les quatre autres scenarios
          // l ont suivi. Celui-ci garde le polygone pour que la capacite reste
          // verrouillee quelque part : un defaut qui change ne doit pas
          // emporter la preuve de ce qu on peut encore faire.
          blades: 6, bladeRotation: 0,
          ghostCount: 4, ghostSpacing: 0.45, ghostIntensity: 0.8, ghostDispersion: 0.5,
          ghostFill: 0.2, ghostClip: 0.55, ghostVariation: 0.6,
          tintHue: 30, tintSaturation: 0.45, tintLightness: 0.6,
          haloIntensity: 0.6, haloRadius: 0.5, veil: 0.28,
          scatter: 0.6, scatterDetail: 70,
          sensor: 1.2, sensorSpacing: 0.05,
          arcs: 0.9,
        });
      },
    },

    // ─── LE VERRE, TRANCHE 1 (2026-08-03) ─────────────────────────────────
    //
    // TOUS SUR mireVerre, et c est le point du plan de portage sur lequel le
    // reste reposait : aucune mire existante ne pouvait montrer les quatre
    // proprietes en meme temps. Elle est ENTIEREMENT ACHROMATIQUE, donc la
    // moindre couleur dans ces references EST la dispersion — la propriete est
    // mesurable au lieu d etre appreciee.
    //
    // QUATORZE BRANCHES POUR TREIZE REFERENCES, et l ecart n est pas un trou :
    // le scenario du cannele simple couvre a lui seul la matiere 0 ET le profil
    // 0, puisqu il faut bien une matiere pour eprouver un profil.
    //
    // La premiere passe en couvrait sept. Le commentaire d alors en annoncait
    // six : il oubliait Poli, et c est le recompte des branches, pas la note,
    // qui a tranche. Les sept manquantes ont ete ecrites ensuite, chacune
    // contre la reference dont elle doit se DISTINGUER plutot que contre la
    // photo nue — un profil se prouve face a un autre profil, une matiere face
    // a celle dont elle partage le code. Mesurer contre l image sans verre
    // n aurait prouve que « ca fait quelque chose », ce qu on savait deja.
    "effet-verre-cannele": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 0, density: 28, depth: 0.55, profile: 0, flat: 0, fillet: 0.12,
          orientation: 0, irregularity: 0, grain: 0.2, thickness: 0.16,
          specular: 0.35, dispersion: 0.4, diffusion: 0.03, relief: 1,
        });
      },
    },

    // MEME MATIERE, AUTRE PROFIL. Tout est identique au precedent sauf la forme
    // de la section : l ecart entre les deux images EST la contribution du
    // profil, isolee. Bourrelet (4) et non un intermediaire, parce que c est le
    // seul dont la derivee est nulle aux DEUX bords — il n a donc rien a faire
    // du conge, et se distingue le plus de l arc.
    "effet-verre-bourrelet": {
      contre: "effet-verre-cannele",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 0, density: 28, depth: 0.55, profile: 4, flat: 0, fillet: 0.12,
          orientation: 0, irregularity: 0, grain: 0.2, thickness: 0.16,
          specular: 0.35, dispersion: 0.4, diffusion: 0.03, relief: 1,
        });
      },
    },

    // MARTELE : la primitive Voronoi lue par ses ARETES (F2 - F1), qui doit
    // rendre des cellules POLYGONALES JOINTIVES de taille quasi constante. Si
    // elle repassait un jour a une lecture par distance au germe, on verrait des
    // domes ronds SEPARES de tailles tres inegales — un ecart massif, que cette
    // reference attrape. C est la meme primitive qui porte Ecorce.
    "effet-verre-martele": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 3, density: 90, depth: 0.6, flat: 0.3,
          irregularity: 0.5, grain: 0.2, thickness: 0.8,
          specular: 0.35, dispersion: 0.3, diffusion: 0.03, relief: 1,
        });
      },
    },

    // ALUMINIUM BROSSE : le seul dont la pente est CONSTANTE dans la cellule et
    // SAUTE a la frontiere — aucune difference finie, aucun conge, l arete vive
    // du metal. C est l inverse exact de toutes les autres matieres, donc la
    // branche la plus facile a casser en croyant uniformiser.
    "effet-verre-aluminium": {
      contre: "effet-verre-martele",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 5, density: 120, depth: 0.5, flat: 0.35,
          irregularity: 0.6, grain: 0.15, thickness: 1.6,
          specular: 0.6, dispersion: 0.2, diffusion: 0.02, relief: 1,
        });
      },
    },

    // CATHEDRALE : bruit FORTEMENT anisotrope, etire d un facteur douze sur le
    // second axe. Ce que cette reference protege est l ANISOTROPIE — un bruit
    // isotrope compilerait, rendrait quelque chose de plausible, et ne
    // correspondrait a aucun verre reel. C etait la premiere version de la
    // source, corrigee depuis.
    "effet-verre-cathedrale": {
      contre: "effet-verre-martele",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 8, density: 40, depth: 0.65, orientation: 0,
          irregularity: 0, grain: 0.2, thickness: 0.9,
          specular: 0.3, dispersion: 0.35, diffusion: 0.03, relief: 1,
        });
      },
    },

    // DEPOLI : aucun deplacement par masses, QUE de la diffusion. Le quart
    // haute frequence de la mire est le seul endroit ou son action se lise —
    // c est lui qui doit disparaitre. Diffusion poussee a .35 et Creux a 0 :
    // si un jour cette matiere se mettait a DEVIER l image, l ecart avec les
    // autres references le dirait, et le quart en rampe le dirait le premier.
    "effet-verre-depoli": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 7, depth: 0, grain: 0.8, thickness: 0.1,
          specular: 0.2, dispersion: 0, diffusion: 0.35, relief: 1,
        });
      },
    },

    // CANNELE CROISE : la meme pente, appliquee aux DEUX axes au lieu d un.
    // Tout est identique au cannele simple sauf la matiere, donc l ecart entre
    // les deux images EST la contribution du second axe, isolee. Ce que la
    // reference protege est la SOMME : si un jour cette branche se mettait a
    // multiplier les deux pentes, elle deviendrait le Gaufre — et le scenario
    // suivant, qui se mesure contre celui-ci, tomberait en meme temps.
    "effet-verre-croise": {
      contre: "effet-verre-cannele",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 1, density: 28, depth: 0.55, profile: 0, flat: 0, fillet: 0.12,
          orientation: 0, irregularity: 0, grain: 0.2, thickness: 0.16,
          specular: 0.35, dispersion: 0.4, diffusion: 0.03, relief: 1,
        });
      },
    },

    // GAUFRE, ET SON \`contre\` EST LE POINT DU SCENARIO. La seule chose qui le
    // separe du Cannele croise est un PRODUIT la ou l autre fait une somme : la
    // pente d un axe modulee par la HAUTEUR de l autre. C est ce produit qui
    // fait des domes ; une somme ferait une grille de sillons croises, ce qui
    // est deja la matiere precedente. Le mesurer contre la photo nue aurait
    // prouve que le Gaufre fait quelque chose ; le mesurer contre le croise
    // prouve qu il fait autre chose QUE LUI, ce qui est la seule question.
    "effet-verre-gaufre": {
      contre: "effet-verre-croise",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 2, density: 28, depth: 0.55, profile: 0, flat: 0, fillet: 0.12,
          orientation: 0, irregularity: 0, grain: 0.2, thickness: 0.16,
          specular: 0.35, dispersion: 0.4, diffusion: 0.03, relief: 1,
        });
      },
    },

    // ECORCE : meme primitive que le Martele, a deux constantes pres —
    // l etirement vertical des plaques (0,42) et l amplitude (0,055 contre
    // 0,030). Les deux matieres partagent leur code par construction, donc la
    // seule chose qui puisse casser sans etre vue est justement ce couple de
    // constantes. Mesure contre le Martele, a parametres identiques : l ecart
    // EST l anisotropie du tronc, et rien d autre.
    "effet-verre-ecorce": {
      contre: "effet-verre-martele",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 4, density: 90, depth: 0.6, flat: 0.3,
          irregularity: 0.5, grain: 0.2, thickness: 0.8,
          specular: 0.35, dispersion: 0.3, diffusion: 0.03, relief: 1,
        });
      },
    },

    // POLI : la matiere la plus facile a rendre INERTE sans que rien ne le
    // signale. Aucun motif, aucune maille, une amplitude minuscule — si un
    // refactor eteignait sa branche, l image resterait plausible (un verre
    // plat qui verdit et qui brille, ce qui est exactement ce que rend le
    // parametre Presence du relief a 0). D ou le creux et l epaisseur pousses,
    // et le micro-relief presque coupe : ce qu on veut lire ici est
    // l ondulation LENTE, pas la rugosite qui l accompagne.
    "effet-verre-poli": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 6, density: 12, depth: 1, flat: 0,
          irregularity: 0, grain: 0.05, thickness: 1.6,
          specular: 0.3, dispersion: 0.3, diffusion: 0.02, relief: 1,
        });
      },
    },

    // La dette Densite de Poli est RESOLUE en tranche 2 : une ancienne sonde a
    // montre qu a 150 le parametre ne resserrait pas un verre, il fabriquait de
    // l aliasing (65,4 % des canaux). Or son infobulle disait deja « Sans objet
    // en Poli ». La branche utilise maintenant une echelle fixe de 0,35 : le
    // parametre est vraiment inerte et le pas de derivation constant ne peut
    // plus depasser le motif qu il mesure.

    // LES TROIS PROFILS RESTANTS, tous sur le cannele simple et tous mesures
    // contre lui : seul \`profile\` change d un scenario a l autre, donc chaque
    // ecart est la contribution d une forme de section, isolee. Meme protocole
    // que le Bourrelet, qui etait le seul profil verrouille de la premiere
    // passe.
    //
    // ARC PLEIN. Le plus dangereux des trois parce que le moins distinct : ce
    // n est pas une autre courbe que l Arc doux, c est la MEME a un facteur
    // 0,35 pres. Une reference qui le confondrait avec son voisin ne dirait
    // rien ; celle-ci se mesure donc contre l Arc doux, la ou le facteur est
    // toute la difference.
    "effet-verre-arc-plein": {
      contre: "effet-verre-cannele",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 0, density: 28, depth: 0.55, profile: 1, flat: 0, fillet: 0.12,
          orientation: 0, irregularity: 0, grain: 0.2, thickness: 0.16,
          specular: 0.35, dispersion: 0.4, diffusion: 0.03, relief: 1,
        });
      },
    },

    // PRISME : pente CONSTANTE et signee, donc un V. C est le seul profil dont
    // la deviation ne varie pas dans la cellule — l image s y deplace en bloc
    // de part et d autre de l arete, au lieu de s etirer continument. Ce que la
    // reference verrouille est donc l ABSENCE de variation dans la cellule ; a
    // quoi cela ressemble sur chaque quart de la mire n est pas affirme ici,
    // faute d avoir ete regarde a une echelle ou ca se tranche.
    "effet-verre-prisme": {
      contre: "effet-verre-cannele",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 0, density: 28, depth: 0.55, profile: 2, flat: 0, fillet: 0.12,
          orientation: 0, irregularity: 0, grain: 0.2, thickness: 0.16,
          specular: 0.35, dispersion: 0.4, diffusion: 0.03, relief: 1,
        });
      },
    },

    // FOND PLAT : plateau exactement plat au centre, flancs en S, derivee NULLE
    // aux deux raccords. Il porte une correction qui ne se voit que sur une
    // reference — la premiere ecriture passait par un cosinus, qui surelevait
    // le centre et donnait une gorge la ou il faut un creux. Un retour a cette
    // forme compilerait, rendrait du plausible, et changerait la matiere.
    "effet-verre-fond-plat": {
      contre: "effet-verre-cannele",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 0, density: 28, depth: 0.55, profile: 3, flat: 0, fillet: 0.12,
          orientation: 0, irregularity: 0, grain: 0.2, thickness: 0.16,
          specular: 0.35, dispersion: 0.4, diffusion: 0.03, relief: 1,
        });
      },
    },

    // REFLET STRUCTURE (matcap optionnel, index 14). Meme mire, memes params que
    // effet-verre-cannele au bit pres, SAUF matcap a 1. L ecart entre les deux
    // images EST donc la contribution du matcap seule, isolee du reste : a dose 0
    // (le defaut, donc effet-verre-cannele) le reflet est la couleur fixe d avant,
    // a dose 1 c est la sphere d environnement lue par la normale. Cette reference
    // GELE le pole dose 1 ; le pole dose 0 est gele par les treize autres, qui
    // toutes tournent au defaut. Sur le cannele les normales varient, donc F et le
    // matcap structurent le reflet et l ecart est franc.
    "effet-verre-matcap": {
      contre: "effet-verre-cannele",
      build: async (r, stack) => {
        const m = await mireVerre(W, H);
        const sourceId = await r.photoSources.register(m);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "verre");
        const a = stack.addLayer("glass", p);
        stack.updateParams(a, {
          material: 0, density: 28, depth: 0.55, profile: 0, flat: 0, fillet: 0.12,
          orientation: 0, irregularity: 0, grain: 0.2, thickness: 0.16,
          specular: 0.35, dispersion: 0.4, diffusion: 0.03, relief: 1, matcap: 1,
        });
      },
    },

    // TRANCHE 2 DU VERRE : les cinq paves avaient leurs cinq scenarios ici, sur
    // la meme mire et avec le meme bloc, chaines par contre pour qu'aucune de
    // leurs branches ne puisse converger en silence. Elles sont RETIREES le
    // 2026-08-27 avec les matieres (ADR-0021).
    //
    // Le retrait n'a demande AUCUN reancrage : la chaine pave etait fermee sur
    // elle-meme — nuage tenait a effet-verre-cannele, les quatre autres a leur
    // voisin de pave, et aucun scenario reste ne pointait vers un pave. Le verre
    // passe donc de dix-huit a treize references, toutes de feuille.

    // COURBES, SUR UNE RAMPE NEUTRE PUIS AVEC UNE CORRECTION VOLONTAIREMENT
    // VISIBLE. La premiere reference verrouille l'identite byte-for-byte du
    // chemin GPU ; la seconde porte a la fois une S-curve maitresse et une
    // dominante rouge, puis se compare a l'identite sur la MEME source.
    "effet-courbes-neutre": {
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        stack.addLayer("curves", p);
      },
    },
    "effet-courbes": {
      contre: "effet-courbes-neutre",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("curves", p);
        stack.updateParams(a, {
          masterPoint1X: 0.24, masterPoint1Y: 0.14,
          masterPoint2X: 0.74, masterPoint2Y: 0.86,
          redPoint1X: 0.5, redPoint1Y: 0.62,
          shadowsMin: 0, shadowsMax: 0.08,
          highlightsMin: 0.92, highlightsMax: 1,
          mix: 1,
        });
      },
    },

    // SOLARISATION — une courbe qui DESCEND puis remonte (ticket 12, tranche 2).
    //
    // CE QUE CE SCENARIO PROUVE, ET QU AUCUN TEST UNITAIRE NE PEUT PROUVER : que
    // le SHADER porte la courbe non monotone. La levee du 2026-08-18 n a touche
    // que \`constrainCurvePoint\`, cote interface — la these etant que le rendu
    // savait deja le faire. Une these pareille se verifie sur des pixels, pas sur
    // le jumeau TypeScript de la courbe, qui partage son code avec l apercu et
    // pourrait tres bien etre le seul des deux a savoir descendre.
    //
    // Sur la RAMPE, pour la meme raison que \`effet-courbes\` : la solarisation
    // EST une reponse tonale, et une rampe l etale sur toute la largeur. Sur la
    // mire commune, la descente serait hachee par le damier.
    //
    // \`contre\` pointe sur \`effet-courbes\` et non sur la rampe nue : ce qu on veut
    // mesurer n est pas qu une courbe agit, c est qu une courbe DESCENDANTE ne
    // rend pas ce que rend une courbe montante.
    "effet-courbes-solarisation": {
      contre: "effet-courbes",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("curves", p);
        stack.updateParams(a, {
          masterPoint1X: 0.35, masterPoint1Y: 0.9,
          masterPoint2X: 0.65, masterPoint2Y: 0.1,
          shadowsMin: 0, shadowsMax: 0.08,
          highlightsMin: 0.92, highlightsMax: 1,
          mix: 1,
        });
      },
    },

    // DUOTONE, SUR LA RAMPE, A SES DEFAUTS EXACTS. Deux choix, deux raisons.
    //
    // La rampe parce que cet effet est une REPONSE TONALE et rien d autre : il
    // remplace chaque niveau de gris par une couleur. Le damier de la mire
    // commune saute d un texel a l autre, donc la correspondance ton -> couleur y
    // devient illisible ; une rampe neutre l etale sur toute la largeur, ou elle
    // se lit d un coup d oeil et se mesure colonne par colonne.
    //
    // Les DEFAUTS parce que ce sont eux que tout le monde voit en premier et que
    // rien ne verrouillait. L effet passait dans \`masque-edge-aware\`, mais en
    // passager d un scenario bati pour le masque : si sa rampe de teintes
    // derivait, cette reference-la changerait sans qu on sache laquelle des deux
    // proprietes a bouge.
    "effet-duotone": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("duotone", p);
        stack.updateParams(a, {
          shadowHue: 350, shadowSaturation: 0.65, shadowLightness: 0.25,
          midtoneHue: 30, midtoneSaturation: 0.5, midtoneLightness: 0.5,
          highlightHue: 220, highlightSaturation: 0.55, highlightLightness: 0.6,
          contrast: 0.55, pivot: 0.5,
        });
      },
    },

    // GRADIENT MAP, SUR LA MEME RAMPE — et le \`contre\` est le point du scenario.
    //
    // « duotone et gradientMap sont-ils des doublons » en est a son troisieme
    // tour, et la question n a jamais eu de MESURE. Poser les deux sur la meme
    // mire, aux memes tons, avec un ecart mesure entre les deux images, la rend
    // enfin chiffrable : si un jour les deux effets rendaient la meme chose, ce
    // scenario rougirait de lui-meme.
    //
    // Conservation du modele a 0 (defaut 0.35) : a son defaut, l effet reinjecte
    // la luminosite d origine sous la teinte, donc la reference verrouillerait un
    // MELANGE de la rampe et de la source. A 0 c est la rampe seule — ce que
    // l effet sait faire et que lui seul sait faire.
    "effet-gradient-map": {
      contre: "effet-duotone",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("gradientMap", p);
        stack.updateParams(a, {
          shadowHue: 235, shadowSaturation: 0.55, shadowLightness: 0.14,
          midHue: 320, midSaturation: 0.42, midLightness: 0.5,
          highHue: 45, highSaturation: 0.6, highLightness: 0.88,
          midPosition: 0.5, blackPoint: 0, whitePoint: 1,
          preserveShading: 0, blendSpace: 1, offset: 0,
          repeat: 1, repeatType: 0, scatter: 0,
        });
      },
    },

    // LA MEME RAMPE, REPLIEE QUATRE FOIS. C est la capacite que duotone n a pas
    // et ne peut pas avoir — trois teintes fixes ne se repetent pas — donc c est
    // elle qui repond a la question de fusion par autre chose qu un avis.
    //
    // Type MIROIR (le defaut) et non Repetition, parce que le miroir est celui
    // qui PROMET quelque chose : « les bandes s enchainent en se refletant, sans
    // arete ». Une arete qui apparaitrait a un repli est un defaut, et cette
    // reference la verrait. Repetition, elle, promet l arete franche : la
    // verrouiller reviendrait a verifier qu une coupure coupe.
    // ⚠️ Le mode Repetition reste donc SANS VERROU, et c est assume plutot que
    // tu — le declarer ici vaut mieux qu une reference qui laisserait croire que
    // les deux branches sont couvertes.
    "effet-gradient-map-repetition": {
      contre: "effet-gradient-map",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("gradientMap", p);
        stack.updateParams(a, {
          shadowHue: 235, shadowSaturation: 0.55, shadowLightness: 0.14,
          midHue: 320, midSaturation: 0.42, midLightness: 0.5,
          highHue: 45, highSaturation: 0.6, highLightness: 0.88,
          midPosition: 0.5, blackPoint: 0, whitePoint: 1,
          preserveShading: 0, blendSpace: 1, offset: 0,
          repeat: 4, repeatType: 0, scatter: 0,
        });
      },
    },

    // ETALONNAGE (2026-09-11, ticket 01 lightroom-develop), sur mirePrimaires —
    // une mire ecrite pour lui. Trois references : le temoin (identite au bit
    // pres, la matrice a reglages nuls renvoie l entree telle quelle), puis deux
    // qui CONTRENT le temoin et n allument qu une chose chacune.
    //
    // Sur mirePrimaires parce que l etalonnage tourne les PRIMAIRES du systeme de
    // couleur : ses six aplats montrent la rotation, sa bande de peau montre ou
    // ca se juge, sa rampe de gris prouve que les gris ne bougent pas.
    "effet-etalonnage-temoin": {
      build: async (r, stack) => {
        const src = await mirePrimaires(W, H);
        const sourceId = await r.photoSources.register(src);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "primaires");
        stack.addLayer("etalonnage", p);
      },
    },
    // BLEU teinte -60, saturation +40 : le teal-and-orange. Les tons froids
    // basculent vers le turquoise et gagnent en chroma ; l ecart au temoin se lit
    // sur les aplats bleu et cyan et sur la peau.
    "effet-etalonnage-bleu": {
      contre: "effet-etalonnage-temoin",
      build: async (r, stack) => {
        const src = await mirePrimaires(W, H);
        const sourceId = await r.photoSources.register(src);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "primaires");
        const a = stack.addLayer("etalonnage", p);
        stack.updateParams(a, { blueHue: -60, blueSaturation: 40 });
      },
    },
    // NUANCE FONCEE +80 : le decalage magenta ne mord que sur les OMBRES
    // (ponderation (1 - luminance)^2 de l entree). Il se lit sur la moitie sombre
    // de la rampe de gris et sur les canaux bas des aplats, pas sur les hautes
    // lumieres. C est le SEUL reglage qui teinte un gris — mais un gris sombre.
    "effet-etalonnage-nuance": {
      contre: "effet-etalonnage-temoin",
      build: async (r, stack) => {
        const src = await mirePrimaires(W, H);
        const sourceId = await r.photoSources.register(src);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "primaires");
        const a = stack.addLayer("etalonnage", p);
        stack.updateParams(a, { shadowTint: 80 });
      },
    },

    // ETAGE DE DEVELOPPEMENT (2026-09-11, ticket 03 lightroom-develop). Deux
    // references : que l etage rend ce que rend le meme effet pose en calque, et
    // que l etage s applique APRES la pile.
    //
    // developpement-etalonnage : l etage regle Bleu teinte -60 sat +40 sur
    // mirePrimaires, SANS aucun calque d effet. L etalonnage vit dans l etage et
    // transforme le composite (la photo). Il doit rendre EXACTEMENT ce que rend
    // effet-etalonnage-bleu (le meme etalonnage en CALQUE) : meme entree, meme
    // shader, deux chemins equivalents (applyMask false rend fs_main tel quel ;
    // le compositing d un calque a opacite 1, fusion normale, sur un fond opaque
    // se reduit a fs_main au bit pres). L assertion identiqueA le PROUVE, elle
    // ne se contente pas d une reference figee.
    "developpement-etalonnage": {
      identiqueA: "effet-etalonnage-bleu",
      develop: { etalonnage: { blueHue: -60, blueSaturation: 40 } },
      build: async (r, stack) => {
        const src = await mirePrimaires(W, H);
        const sourceId = await r.photoSources.register(src);
        stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "primaires");
      },
    },
    // developpement-apres-pile : un calque grain (memes graine et parametres que
    // grain-graine-fixe), puis l etage etalonnage bleu. Le contre est le grain
    // SEUL -> ce qui reste est exactement ce que l etage AJOUTE au composite deja
    // graine, ce qui prouve que l etage tourne APRES la pile. La reference gele
    // l ORDRE : appliquer l etalonnage AVANT le grain rendrait d autres pixels et
    // la ferait rougir (verifie une fois en inversant, puis remis).
    "developpement-apres-pile": {
      contre: "grain-graine-fixe",
      develop: { etalonnage: { blueHue: -60, blueSaturation: 40 } },
      build: async (r, stack) => {
        const a = stack.addLayer("grain");
        stack.updateParams(a, { intensity: 0.3, size: 3, seed: 7 });
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

    // FEATHER A GRAND RAYON : la paire qui MONTRE le profil en S (2026-08-19).
    // Les trois scenarios refine ci-dessus travaillent a feather 2 et 6, ou la
    // difference rampe/S tient dans 9 LSB — un verrou qui ne montre pas la
    // propriete ne verrouille que du bruit (lecon lensBlur du 2026-08-01).
    // Ici : masque a bord FRANC (rectangle net, pas brushRaster dont le bord
    // est deja doux), feather 24 — la transition s etale sur ~48 px et le S
    // se lit. Le profil vise est celui mesure chez Affinity (erf,
    // sigma = 0,4 rayon), approche par quatre fenetres pondereees sur la SAT
    // (FEATHER_WINDOWS, src/mask/refineEdgeWgsl.ts) — ecart au erf borne par
    // test/mask/featherProfile.test.ts.
    "masque-feather-fort-temoin": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("duotone");
        const m = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
          m[y * W + x] = (x >= W * 0.25 && x < W * 0.75 && y >= H * 0.25 && y < H * 0.75) ? 255 : 0;
        stack.updateBrushMask(a, m);
      },
    },
    "masque-feather-fort": {
      contre: "masque-feather-fort-temoin",
      build: async (r, stack) => {
        const a = stack.addLayer("duotone");
        const m = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
          m[y * W + x] = (x >= W * 0.25 && x < W * 0.75 && y >= H * 0.25 && y < H * 0.75) ? 255 : 0;
        stack.updateBrushMask(a, m);
        stack.updateRefineEdge(a, { feather: 24 });
      },
    },

    // L OVERLAY DE MASQUE (safelight : voile rouge + contour pointille), et
    // QUATRE scenarios pour lui — deux paires temoin/overlay.
    //
    // POURQUOI IL N EN AVAIT AUCUN JUSQU ICI, et ce n etait pas un oubli : il
    // ne vit QUE sur la surface de presentation. La fonction maskOverlayFor le
    // refuse a la destination export par construction (pour qu il n atteigne
    // jamais un JPEG), or tous les scenarios sauf le damier lisent exportFrame.
    // Le verrou etait donc structurellement aveugle a lui — modifie le
    // 2026-08-13, test:render est reste vert, et c est ce qui a fait ecrire
    // dans le ROADMAP que « le contour pointille, le voile et leur
    // anticrenelage ne sont tenus par rien ».
    //
    // CE QU IL A FALLU POUR QUE CA DEVIENNE VERROUILLABLE : le contour est
    // POINTILLE et sa phase avance avec le temps. L horloge est desormais un
    // port de FramePipelineExecutor, que ce harnais fixe (voir la construction
    // du Renderer plus bas). Sans ca, deux rendus de la meme pile ne donnent
    // pas les memes octets et le harnais refuse a juste titre de comparer.
    //
    // LA PAIRE EST LE POINT. Un scenario d overlay seul verrouillerait
    // l ensemble « image + voile + contour » sans jamais isoler l overlay : son
    // temoin rend exactement la meme pile SANS setMaskOverlay, donc l ecart
    // entre les deux EST l aide de visee, et rien d autre.
    "masque-overlay-temoin": {
      surface: "canvas",
      build: async (r, stack) => {
        const a = stack.addLayer("duotone");
        stack.updateBrushMask(a, brushRaster(W, H));
      },
    },

    // MASQUE PEINT : une frontiere franche, la valeur ne traverse 0.5 qu une
    // fois. C est le cas pour lequel le contour est ecrit, et il doit rendre
    // une LIGNE.
    "masque-overlay-pinceau": {
      surface: "canvas",
      overlay: "L1",
      contre: "masque-overlay-temoin",
      build: async (r, stack) => {
        const a = stack.addLayer("duotone");
        stack.updateBrushMask(a, brushRaster(W, H));
      },
    },

    // MASQUE PAR TONALITE SUR UNE IMAGE BRUITEE, et c est LE cas qui a produit
    // le defaut du 2026-08-13 : la valeur du masque traverse 0.5 des milliers
    // de fois — une par grain — donc le contour s allumait partout et le motif
    // de pointilles remplissait la SURFACE au lieu de tracer une ligne.
    // L arbitrage d Antoine a ete de lisser le masque POUR LE CONTOUR
    // seulement (25 taps, pas d ecran plancher a un texel), le voile continuant
    // de lire la valeur brute.
    //
    // Ce que ce scenario tient et qu aucun autre ne peut tenir : ce lissage.
    // Le retirer, reduire son rayon, ou le faire deriver de la derivee des UV
    // au lieu de l echelle ecran, tout cela remplit la zone de transition de
    // hachures — donc deplace des dizaines de milliers de canaux ici.
    "masque-overlay-tonalite-temoin": {
      fond: false,
      surface: "canvas",
      build: async (r, stack) => {
        const bruit = await mireBruit(W, H);
        const sourceId = await r.photoSources.register(bruit);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bruit");
        const a = stack.addLayer("grain", p);
        stack.updateParams(a, { mode: 1, intensity: 0.35, size: 1, chroma: 0.8, seed: 7 });
        const l = stack.addMaskSource(a, "luminosity");
        // Bornes calees SUR LES DEUX PALIERS de la mire (0,30 et 0,62 avec
        // +-3 % de bruit) : la rampe basse coupe en plein dans le grain du
        // premier palier, donc la valeur du masque y oscille autour de 0.5.
        // C est exactement la situation qui faisait exploser le contour.
        stack.updateMaskSourceParams(a, l, {
          shadowsMin: 0, shadowsMax: 0.32, highlightsMin: 0.9, highlightsMax: 1,
          tolerance: 0.02, invert: 0,
        });
      },
    },

    "masque-overlay-tonalite": {
      fond: false,
      surface: "canvas",
      overlay: "L1",
      contre: "masque-overlay-tonalite-temoin",
      build: async (r, stack) => {
        const bruit = await mireBruit(W, H);
        const sourceId = await r.photoSources.register(bruit);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bruit");
        const a = stack.addLayer("grain", p);
        stack.updateParams(a, { mode: 1, intensity: 0.35, size: 1, chroma: 0.8, seed: 7 });
        const l = stack.addMaskSource(a, "luminosity");
        stack.updateMaskSourceParams(a, l, {
          shadowsMin: 0, shadowsMax: 0.32, highlightsMin: 0.9, highlightsMax: 1,
          tolerance: 0.02, invert: 0,
        });
      },
    },

    // LIGHT LEAK (2026-08-05), et DEUX references pour un seul effet — la
    // seconde n est pas une illustration, c est la preuve que sa couleur est
    // DERIVEE et non peinte.
    //
    // Sur \`mireBokeh\`, pour la meme raison que \`lensFlare\` : c est la seule mire
    // du dossier qui soit essentiellement NOIRE, et une coulee posee en Ecran ne
    // se lit que sur du sombre. Ses points isoles servent en prime de temoin du
    // mode de fusion — l Ecran doit les laisser intacts la ou la coulee est
    // noire.
    //
    // ⚠️ LE MODE DE FUSION EST POSE A LA MAIN. \`defaultBlendMode\` est applique
    // par \`App.tsx\` a l ajout du calque, PAS par \`LayerStack.addLayer\` : le
    // modele de calques ne connait pas le registre d effets. Sans cette ligne le
    // calque serait en Normal et la reference verrouillerait la coulee seule sur
    // fond noir — ce qui ne prouverait rien du compositing.
    "effet-light-leak": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bokeh");
        const a = stack.addLayer("lightLeak", p);
        stack.updateParams(a, {
          origineX: 1, origineY: 0.32, direction: 195, portee: 0.62,
          largeur: 0.13, ouverture: 1.1, attenuation: 1.5,
          intensite: 1.35, chaleur: 0.55,
          irregularite: 0.38, echelleBruit: 5.5, graine: 0,
        });
        at(stack, a).blendMode = "screen";
      },
    },

    // LE MEME, COUCHES D EMULSION EGALISEES (chaleur 0). Tout est identique par
    // ailleurs — meme geometrie, meme bruit, meme graine — donc l ecart entre
    // les deux images EST la reponse chromatique du film, et rien d autre.
    //
    // Ce que ce temoin rend opposable : que le degrade rouge-orange-jaune-blanc
    // sort d un MECANISME (trois saturations exponentielles a vitesses
    // differentes) et non de trois arrets de couleur poses a la main. Si un jour
    // quelqu un remplacait le modele par une rampe peinte, cette paire cesserait
    // de se comporter comme elle se comporte : a chaleur 0 une rampe peinte
    // resterait coloree, la ou ce modele rend une coulee strictement neutre.
    "effet-light-leak-neutre": {
      contre: "effet-light-leak",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bokeh");
        const a = stack.addLayer("lightLeak", p);
        stack.updateParams(a, {
          origineX: 1, origineY: 0.32, direction: 195, portee: 0.62,
          largeur: 0.13, ouverture: 1.1, attenuation: 1.5,
          intensite: 1.35, chaleur: 0,
          irregularite: 0.38, echelleBruit: 5.5, graine: 0,
        });
        at(stack, a).blendMode = "screen";
      },
    },

    // TRANSFORM DU RENDU (ticket 24, voie B) : le MEME light leak, APLATI sur
    // l axe Y (scaleY 0.4). Le temoin est \`effet-light-leak\` : tout est
    // identique par ailleurs, donc l ecart entre les deux images EST
    // l etirement, et rien d autre.
    //
    // CE QUE LA MIRE PEUT MONTRER, verifie avant d ecrire : le light leak est un
    // effet de CHAMP (il ne lit aucun texel de l image en dessous), donc son UV
    // deforme aplatit la coulee elle-meme, visiblement. L ancre est la position
    // de l effet (origineX 1, origineY 0.32), pas le centre : la coulee se
    // comprime vers cette ligne. Sur \`mireBokeh\` (essentiellement noire) et en
    // Ecran, comme les deux references ci-dessus.
    //
    // ⚠️ PNG NON GENERE PAR CE COMMIT (un autre agent tient le harnais render).
    // La session principale generera la reference et l entree ATTENDU tient deja
    // sa place dans renderRefs.test.mjs.
    "effet-transform-lightleak": {
      contre: "effet-light-leak",
      build: async (r, stack) => {
        const points = await mireBokeh(W, H);
        const sourceId = await r.photoSources.register(points);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bokeh");
        const a = stack.addLayer("lightLeak", p);
        stack.updateParams(a, {
          origineX: 1, origineY: 0.32, direction: 195, portee: 0.62,
          largeur: 0.13, ouverture: 1.1, attenuation: 1.5,
          intensite: 1.35, chaleur: 0.55,
          irregularite: 0.38, echelleBruit: 5.5, graine: 0,
        });
        at(stack, a).blendMode = "screen";
        at(stack, a).effectTransform = { scaleX: 1, scaleY: 0.4 };
      },
    },

    // ── APLAT : UNE COULEUR UNIE, BORNEE ──────────────────────────────────
    //
    // Trois scenarios pour trois proprietes distinctes, et le troisieme est le
    // seul qui puisse attraper la decision la plus facile a defaire.
    //
    // CE QUE LA MIRE PEUT MONTRER, verifie avant d ecrire : un aplat est une
    // REGION, donc n importe quelle mire structuree suffit a lire ou il commence
    // et ou il finit. C est l inverse du piege de \`lensBlur\`, qui demandait un
    // point brillant isole — ici la propriete est geometrique, pas tonale.

    // RECTANGLE TOURNE, bord franc. Verrouille la couverture, la rotation en
    // espace isotrope et la couleur. La rotation est a 20 degres et non a 0 ou
    // 90 : un rectangle droit ne distinguerait pas une rotation correcte d une
    // rotation absente, et un rectangle a 90 degres ne distinguerait pas une
    // rotation d un echange largeur/hauteur.
    "effet-aplat": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("aplat");
        stack.updateParams(a, {
          borne: 1,
          // GRAND, et c est le gate de signal qui l a impose. A 0,5 x 0,32
          // l ellipse ne s ecartait du rectangle que sur 2,96 % des canaux :
          // leur difference n est QUE les quatre coins, dont l aire vaut
          // 1 - pi/4 de la boite englobante, soit 21,5 % — donc 21,5 % d une
          // petite boite ne fait rien. A 0,8 x 0,6 la paire porte ~10 %.
          centreX: 0.46, centreY: 0.52, largeur: 0.8, hauteur: 0.6,
          rotation: 20, adoucissement: 0,
          teinte: 35, saturation: 0.3, clarte: 0.9,
        });
      },
    },

    // LA MEME GEOMETRIE EN ELLIPSE. Tout est identique par ailleurs, donc l ecart
    // entre les deux images EST la difference des deux primitives, et rien
    // d autre. Ce qu il attrape et qu un scenario isole ne pourrait pas : les
    // deux branches partagent la meme fonction de couverture, donc une erreur
    // dans la distance de l une seule passerait inapercue si chacune n etait
    // comparee qu a la photo nue.
    "effet-aplat-ellipse": {
      contre: "effet-aplat",
      build: async (r, stack) => {
        const a = stack.addLayer("aplat");
        stack.updateParams(a, {
          borne: 2,
          // GRAND, et c est le gate de signal qui l a impose. A 0,5 x 0,32
          // l ellipse ne s ecartait du rectangle que sur 2,96 % des canaux :
          // leur difference n est QUE les quatre coins, dont l aire vaut
          // 1 - pi/4 de la boite englobante, soit 21,5 % — donc 21,5 % d une
          // petite boite ne fait rien. A 0,8 x 0,6 la paire porte ~10 %.
          centreX: 0.46, centreY: 0.52, largeur: 0.8, hauteur: 0.6,
          rotation: 20, adoucissement: 0,
          teinte: 35, saturation: 0.3, clarte: 0.9,
        });
      },
    },

    // L APLAT COUVRE LA OU IL N Y A RIEN, et c est le seul scenario qui le dise.
    //
    // Toile 320 x 320 pour une mire de 256 : une bande de 32 px reste non
    // couverte sur les quatre cotes, et l export l aplatit en BLANC (ADR-0006).
    // Le rectangle est pose a cheval sur le bord gauche, donc une moitie tombe
    // sur la photo et l autre sur le passe-partout.
    //
    // CE QU IL VERROUILLE : \`outAlpha = max(color.a, couverture)\` dans
    // \`aplat.ts\`. Avec l alpha d entree preserve — l ecriture naturelle, et
    // celle de tous les autres effets du registre — la moitie exterieure
    // resterait BLANCHE, et le cas 453 du cahier (un aplat colore A
    // COTE de la photographie) serait irrealisable sans que rien ne rougisse :
    // l effet aurait l air parfaitement correct partout ou une photo couvre.
    "effet-aplat-hors-photo": {
      toile: { width: 320, height: 320 },
      build: async (r, stack) => {
        const a = stack.addLayer("aplat");
        stack.updateParams(a, {
          borne: 1,
          centreX: 0.1, centreY: 0.5, largeur: 0.24, hauteur: 0.7,
          rotation: 0, adoucissement: 0,
          teinte: 200, saturation: 0.6, clarte: 0.5,
        });
      },
    },

    // LE POLYGONE, compare au RECTANGLE de meme boite. Tout est identique par
    // ailleurs — meme centre, meme largeur, meme hauteur, meme rotation, meme
    // couleur — donc l ecart entre les deux images EST la primitive, et rien
    // d autre. Un hexagone ne remplit qu environ deux tiers de sa boite
    // englobante, ce qui laisse largement de quoi discriminer (contrairement au
    // couple rectangle/ellipse, ou le gate a d abord rougi a 2,96 %).
    "effet-aplat-polygone": {
      contre: "effet-aplat",
      build: async (r, stack) => {
        const a = stack.addLayer("aplat");
        stack.updateParams(a, {
          borne: 3, cotes: 6,
          centreX: 0.46, centreY: 0.52, largeur: 0.8, hauteur: 0.6,
          rotation: 20, adoucissement: 0,
          teinte: 35, saturation: 0.3, clarte: 0.9,
        });
      },
    },

    // L INVERSE, SUR LE MEME HEXAGONE que le scenario precedent (ticket 12,
    // tranche 2). Tout est identique sauf le drapeau, donc les deux images sont
    // COMPLEMENTAIRES : la ou l une porte l encre, l autre porte la photo. C est
    // la vignette a geometrie, celle que la source de masque radiale ne sait pas
    // produire — et le seul scenario du dossier ou l encre sort du cadre de la
    // forme au lieu d y entrer.
    //
    // ⚠️ Le \`contre\` se lit A L ENVERS de l habitude : un ecart ENORME est
    // attendu (les deux images se partagent le cadre), et c est un ecart FAIBLE
    // qui signalerait le defaut — un drapeau non lu rendrait 0 %.
    "effet-aplat-inverse": {
      contre: "effet-aplat-polygone",
      build: async (r, stack) => {
        const a = stack.addLayer("aplat");
        stack.updateParams(a, {
          borne: 3, cotes: 6,
          centreX: 0.46, centreY: 0.52, largeur: 0.8, hauteur: 0.6,
          rotation: 20, adoucissement: 0,
          teinte: 35, saturation: 0.3, clarte: 0.9,
          inverse: 1,
        });
      },
    },

    // LE REMPLISSAGE EN DEGRADE, sur la MEME forme que \`effet-aplat\`. Seul le
    // remplissage change, donc l ecart est la transition et rien d autre.
    //
    // CE QU IL VERROUILLE ET QU UN OEIL NE VERRAIT PAS : que les deux arrets
    // sont convertis en LINEAIRE avant d etre interpoles. Un fondu melange en
    // gamma passe par un milieu assombri — visible sur une paire tres contrastee
    // comme celle-ci (creme vers bleu sombre), invisible sur deux teintes
    // voisines. Le choix de couleurs de ce scenario n est donc pas decoratif.
    "effet-aplat-degrade": {
      contre: "effet-aplat",
      build: async (r, stack) => {
        const a = stack.addLayer("aplat");
        stack.updateParams(a, {
          borne: 1,
          centreX: 0.46, centreY: 0.52, largeur: 0.8, hauteur: 0.6,
          rotation: 20, adoucissement: 0,
          teinte: 35, saturation: 0.3, clarte: 0.9,
          remplissage: 1, angleDegrade: 30, etendueDegrade: 0.7,
          teinte2: 225, saturation2: 0.8, clarte2: 0.18,
        });
      },
    },

    // ── LES TROIS SOURCES PARAMETRIQUES, CHACUNE SEULE ────────────────────
    //
    // Elles n avaient AUCUNE reference le 2026-08-05 : le registre en sert
    // trois (\`mask/sources/registry.ts\`), et le seul verrou qui en touchait une
    // etait \`masque-pinceau-degrade\`, ou le degrade voyage en PASSAGER — melange
    // a un raster de pinceau, a un mode intersect et a trois passes de refine
    // edge. Si sa rampe derivait, cette reference-la changerait sans qu on sache
    // laquelle des quatre proprietes a bouge. C est le meme defaut que celui
    // releve pour \`duotone\` dans \`masque-edge-aware\`, et il se corrige pareil :
    // un scenario par propriete.
    //
    // CHACUN SE COMPARE AU MEME EFFET SANS MASQUE, et c est tout l interet du
    // montage. Un \`contre\` sur la photo nue prouverait seulement que l effet
    // agit. Contre un temoin identique au masque pres, l ecart mesure est
    // exactement ce que le MASQUE retire, et rien d autre.
    //
    // ⚠️ TOUS PORTENT \`fond: false\`, ET C EST LA CONDITION POUR QUE LE VERROU
    // MESURE QUELQUE CHOSE. \`Renderer.parametricMaskSourceTexture()\` sert au
    // masque la photo la plus BASSE de la pile — pas la photo du calque masque.
    // Avec le fond du harnais en place, la premiere version de ces scenarios
    // generait donc ses masques depuis la mire commune pendant qu on regardait
    // une rampe : les references en sont sorties avec un damier imprime dedans,
    // ce qui n a ete vu qu en les OUVRANT. Le harnais etait vert, la gate de
    // signal aussi — les deux mesuraient bien un ecart, simplement pas celui
    // qu on croyait. En posant soi-meme sa mire comme calque du bas, l image
    // guide et l image visible redeviennent la meme.
    "masque-rampe-temoin": {
      fond: false,
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("duotone", p);
        stack.updateParams(a, {
          shadowHue: 350, shadowSaturation: 0.65, shadowLightness: 0.25,
          midtoneHue: 30, midtoneSaturation: 0.5, midtoneLightness: 0.5,
          highlightHue: 220, highlightSaturation: 0.55, highlightLightness: 0.6,
          contrast: 0.55, pivot: 0.5,
        });
      },
    },

    "masque-degrade": {
      fond: false,
      contre: "masque-rampe-temoin",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("duotone", p);
        stack.updateParams(a, {
          shadowHue: 350, shadowSaturation: 0.65, shadowLightness: 0.25,
          midtoneHue: 30, midtoneSaturation: 0.5, midtoneLightness: 0.5,
          highlightHue: 220, highlightSaturation: 0.55, highlightLightness: 0.6,
          contrast: 0.55, pivot: 0.5,
        });
        // VERTICAL sur une rampe HORIZONTALE, a dessein : les deux axes sont
        // orthogonaux, donc l image finale porte les deux informations sans que
        // l une puisse se faire passer pour l autre. Un degrade horizontal aurait
        // suivi la rampe, et un decalage de son axe se serait lu comme un
        // changement de la reponse tonale de duotone.
        const g = stack.addMaskSource(a, "gradient");
        stack.updateMaskSourceParams(a, g, {
          angle: 90, startX: 0.5, startY: 0.15, endX: 0.5, endY: 0.85, feather: 0.12, invert: 0,
        });
      },
    },

    // LE DEGRADE RADIAL (2026-08-14), ET SA PAIRE. Promis en vague 1 par le PRD
    // de masquage (« Degrade lineaire/radial »), livre a moitie, et le manque n a
    // ete signale nulle part pendant 27 jours — le PRD s en servait meme comme
    // MOTIF pour differer la selection rect/ellipse.
    //
    // TOILE 320 x 192, ET C EST LE POINT DU SCENARIO. Un radial doit rendre un
    // CERCLE sur l image, or l espace UV n est pas isotrope : sans correction
    // d aspect, le meme rayon donne 80 px sur un axe et 133 sur l autre. Sur une
    // toile carree le defaut serait invisible — la reference verrouillerait un
    // cercle par accident. Les deux scenarios rendent la meme pile, le second
    // avec le masque : leur DIFFERENCE est l empreinte du masque, et sa boite
    // englobante est ce que mesure la garde de renderRefs.test.mjs.
    //
    // Le centre est le point de DEPART et le bord le point d ARRIVEE : aucun
    // parametre en plus que le lineaire, et basculer de forme ne perd aucun
    // reglage.
    "masque-degrade-radial-temoin": {
      fond: false,
      toile: { width: 320, height: 192 },
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: 160, y: 96, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("duotone", p);
        stack.updateParams(a, {
          shadowHue: 350, shadowSaturation: 0.65, shadowLightness: 0.25,
          midtoneHue: 30, midtoneSaturation: 0.5, midtoneLightness: 0.5,
          highlightHue: 220, highlightSaturation: 0.55, highlightLightness: 0.6,
          contrast: 0.55, pivot: 0.5,
        });
      },
    },

    "masque-degrade-radial": {
      fond: false,
      toile: { width: 320, height: 192 },
      contre: "masque-degrade-radial-temoin",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: 160, y: 96, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("duotone", p);
        stack.updateParams(a, {
          shadowHue: 350, shadowSaturation: 0.65, shadowLightness: 0.25,
          midtoneHue: 30, midtoneSaturation: 0.5, midtoneLightness: 0.5,
          highlightHue: 220, highlightSaturation: 0.55, highlightLightness: 0.6,
          contrast: 0.55, pivot: 0.5,
        });
        const g = stack.addMaskSource(a, "gradient");
        // Centre au milieu, bord a 0,25 en X : rayon de 80 px sur les DEUX axes
        // une fois l aspect corrige (0,25 x 320 = 80 ; 0,4167 x 192 = 80).
        // Adoucissement nul, pour que la frontiere soit mesurable au pixel.
        stack.updateMaskSourceParams(a, g, {
          angle: 0, startX: 0.5, startY: 0.5, endX: 0.75, endY: 0.5, feather: 0.0001, invert: 0, mode: 1,
        });
      },
    },

    // LUMINOSITE, SUR LA RAMPE — et la mire est le test. Cette source selectionne
    // deux PLAGES de ton, les ombres et les hautes lumieres, en laissant les tons
    // moyens dehors. Une rampe neutre est la seule mire qui etale l axe des tons
    // sur la largeur : l effet doit donc apparaitre aux DEUX BOUTS et manquer au
    // milieu, ce qui est une signature qu aucun autre defaut ne peut imiter.
    //
    // ⚠️ Les bornes ne tombent PAS aux fractions annoncees de la largeur. La
    // luminance est calculee en LINEAIRE (\`colorLinear\`), la rampe est ecrite en
    // sRGB : le seuil 0,33 lineaire tombe vers 62 % de la largeur, pas 33 %. Ce
    // n est pas un defaut a corriger, c est la coherence « lineaire strict » du
    // depot — l ecrire ici evite qu une relecture future prenne l asymetrie de la
    // reference pour une derive.
    "masque-luminosite": {
      fond: false,
      contre: "masque-rampe-temoin",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("duotone", p);
        stack.updateParams(a, {
          shadowHue: 350, shadowSaturation: 0.65, shadowLightness: 0.25,
          midtoneHue: 30, midtoneSaturation: 0.5, midtoneLightness: 0.5,
          highlightHue: 220, highlightSaturation: 0.55, highlightLightness: 0.6,
          contrast: 0.55, pivot: 0.5,
        });
        const l = stack.addMaskSource(a, "luminosity");
        stack.updateMaskSourceParams(a, l, {
          shadowsMin: 0, shadowsMax: 0.2, highlightsMin: 0.7, highlightsMax: 1,
          tolerance: 0.06, invert: 0,
        });
      },
    },

    // TEMOIN DU RANGE COULEUR : les pastilles avec l echange de canaux, SANS
    // masque. Il existe pour que le scenario suivant mesure le masque et lui
    // seul ; le publier separement le rend aussi lisible a l oeil quand une
    // reference bouge.
    //
    // ⚠️ PAS duotone ICI, contrairement aux deux scenarios ci-dessus, et la
    // raison est mesuree : duotone est une reponse TONALE, il remplace chaque
    // luminance par une couleur. Sur six aplats a variation de 4 %, il rendait
    // 36 valeurs distinctes pour un plancher de 64, et la gate de signal a
    // refuse la reference — a juste titre, elle aurait ete presque inerte.
    // Monter la variation de la mire etait la fausse solution : a +/-6 % le
    // bord des pastilles visees sort de la selection et le verrou ne mesurerait
    // plus le masque.
    //
    // Une permutation de canaux, elle, est une MATRICE : elle travaille canal
    // par canal et preserve donc toute la variete de l entree. Elle se lit d un
    // coup d oeil sur des teintes franches, ce qui est exactement ce qu il faut
    // pour voir ou le masque laisse passer.
    //
    // ⚠️ ROTATION CYCLIQUE (R vient du bleu, V du rouge, B du vert) ET NON UN
    // ECHANGE DE DEUX CANAUX. Un echange rouge/bleu laisse INVARIANTE toute
    // couleur dont le rouge et le bleu sont proches — la pastille verte
    // (40, 180, 60) en fait partie, et elle rendait donc le meme vert masquee ou
    // non. Cette pastille-la ne temoignait de rien, ce qui n a ete vu qu en
    // comparant les deux references a l oeil : la gate de signal ne compte pas
    // les pastilles, elle compte les canaux. Une rotation n a d invariant que le
    // gris, qu aucune pastille n approche.
    //
    // A LIRE EN COMPARANT LES DEUX REFERENCES : dans l image masquee, la rangee
    // du BAS est la preuve principale — ses trois pastilles reviennent a leur
    // couleur d origine, franchement. En haut, la pastille rouge sous rotation
    // devient un vert VIF a cote du vert MOYEN de la pastille verte restee
    // intacte : les deux se distinguent, mais moins que les autres. C est la
    // seule paire un peu proche de la planche, et la dire evite de la relire un
    // jour comme un defaut.
    "masque-pastilles-temoin": {
      fond: false,
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const pastilles = await mirePastilles(W, H);
        const sourceId = await r.photoSources.register(pastilles);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "pastilles");
        const a = stack.addLayer("channelMixer", p);
        stack.updateParams(a, {
          redFromRed: 0, redFromGreen: 0, redFromBlue: 1,
          greenFromRed: 1, greenFromGreen: 0, greenFromBlue: 0,
          blueFromRed: 0, blueFromGreen: 1, blueFromBlue: 0,
          preserveLuma: 0, monochrome: 0, colorize: 0,
        });
      },
    },

    // RANGE COULEUR, DEUX ECHANTILLONS DANS LA MEME SOURCE. Deux et non un,
    // parce que le cumul est la propriete que cette source est seule a porter —
    // un seul echantillon serait indiscernable d une simple selection par teinte.
    // Rouge et bleu sont pris aux DEUX BOUTS de la grille (pastilles 0 et 2 de la
    // premiere ligne), donc un masque qui suivrait la position au lieu de la
    // couleur rendrait une bande continue et se verrait immediatement.
    //
    // ⚠️ Les echantillons sont convertis en LINEAIRE. Le shader compare a
    // \`colorLinear\` ; donnes en sRGB ils viseraient a plus de deux tolerances de
    // leur cible et le masque sortirait VIDE — sans erreur, et une reference de
    // masque vide ressemble a une reference.
    "masque-range-couleur": {
      fond: false,
      contre: "masque-pastilles-temoin",
      build: async (r, stack) => {
        const pastilles = await mirePastilles(W, H);
        const sourceId = await r.photoSources.register(pastilles);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "pastilles");
        // Meme effet et memes reglages que le temoin, a l identique : l ecart
        // mesure entre les deux images est alors exactement ce que le masque
        // retire, et rien d autre.
        const a = stack.addLayer("channelMixer", p);
        stack.updateParams(a, {
          redFromRed: 0, redFromGreen: 0, redFromBlue: 1,
          greenFromRed: 1, greenFromGreen: 0, greenFromBlue: 0,
          blueFromRed: 0, blueFromGreen: 1, blueFromBlue: 0,
          preserveLuma: 0, monochrome: 0, colorize: 0,
        });
        const c = stack.addMaskSource(a, "colorRange");
        stack.updateMaskSourceParams(a, c, {
          // Tolerance 0,20 : les deux pastilles visees sont a 0, la plus proche
          // des quatre autres est a 0,4057 en lineaire. Deux fois la marge.
          tolerance: 0.2, hardness: 0.5, invert: 0,
          samples: [...PASTILLES[0].map(versLineaire), ...PASTILLES[2].map(versLineaire)],
        });
      },
    },

    // ── FORME GEOMETRIQUE : UN TEMOIN, DEUX FORMES (ticket 11) ───────────
    //
    // La source shape (mask/sources/shape.ts) est le marquee de Photoshop chez
    // nous : un masque borne par une boite, rectangle ou ellipse. Meme montage
    // que le degrade radial : les trois scenarios rendent la meme pile duotone
    // sur une rampe, les deux formes avec le masque en plus. L ecart au temoin
    // EST l empreinte de la forme, et sa boite englobante est ce que mesure la
    // garde de renderRefs.test.mjs.
    //
    // TOILE 320 x 192, ET C EST LE POINT. L espace UV n est pas isotrope : sans
    // correction d aspect, une ellipse inscrite dans une boite carree en UV
    // sortirait aplatie, et le feather d un rectangle serait plus epais sur un
    // axe. Sur une toile carree le defaut serait invisible. La forme est bornee
    // sur les DEUX axes (c est une boite), donc son empreinte ne peut pas se
    // confondre avec la reponse tonale de duotone, quel que soit le sens de la
    // rampe.
    "masque-forme-temoin": {
      fond: false,
      toile: { width: 320, height: 192 },
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: 160, y: 96, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("duotone", p);
        stack.updateParams(a, {
          shadowHue: 350, shadowSaturation: 0.65, shadowLightness: 0.25,
          midtoneHue: 30, midtoneSaturation: 0.5, midtoneLightness: 0.5,
          highlightHue: 220, highlightSaturation: 0.55, highlightLightness: 0.6,
          contrast: 0.55, pivot: 0.5,
        });
      },
    },

    // RECTANGLE, avec un feather non nul : c est ce qui prouve la propriete du
    // rectangle, un bord adouci d epaisseur CONSTANTE tout autour, coins
    // compris (SDF de boite, jamais un produit de smoothstep par axe qui
    // creuserait les coins). Boite 0,2..0,8 en X et 0,25..0,75 en Y : 192 px x
    // 96 px sur la toile, large fraction du cadre.
    "masque-forme-rectangle": {
      fond: false,
      toile: { width: 320, height: 192 },
      contre: "masque-forme-temoin",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: 160, y: 96, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("duotone", p);
        stack.updateParams(a, {
          shadowHue: 350, shadowSaturation: 0.65, shadowLightness: 0.25,
          midtoneHue: 30, midtoneSaturation: 0.5, midtoneLightness: 0.5,
          highlightHue: 220, highlightSaturation: 0.55, highlightLightness: 0.6,
          contrast: 0.55, pivot: 0.5,
        });
        const s = stack.addMaskSource(a, "shape");
        stack.updateMaskSourceParams(a, s, {
          x0: 0.2, y0: 0.25, x1: 0.8, y1: 0.75, feather: 0.06, invert: 0, mode: 0,
        });
      },
    },

    // ELLIPSE, boite CARREE SUR LA TOILE : demi-dimensions 0,15 en X et 0,25 en
    // Y, soit 0,3 x 320 = 96 px et 0,5 x 192 = 96 px. Corrigee de l aspect, la
    // forme sort donc en CERCLE de 48 px de rayon, pas en ellipse — c est le
    // test de l isotropie sur toile non carree. Feather quasi nul pour que la
    // frontiere soit mesurable au pixel.
    "masque-forme-ellipse": {
      fond: false,
      toile: { width: 320, height: 192 },
      contre: "masque-forme-temoin",
      build: async (r, stack) => {
        const rampe = await mireRampe(W, H);
        const sourceId = await r.photoSources.register(rampe);
        const p = stack.addPhotoLayer(sourceId, { x: 160, y: 96, scaleX: 1, scaleY: 1, rotation: 0 }, "rampe");
        const a = stack.addLayer("duotone", p);
        stack.updateParams(a, {
          shadowHue: 350, shadowSaturation: 0.65, shadowLightness: 0.25,
          midtoneHue: 30, midtoneSaturation: 0.5, midtoneLightness: 0.5,
          highlightHue: 220, highlightSaturation: 0.55, highlightLightness: 0.6,
          contrast: 0.55, pivot: 0.5,
        });
        const s = stack.addMaskSource(a, "shape");
        stack.updateMaskSourceParams(a, s, {
          x0: 0.35, y0: 0.25, x1: 0.65, y1: 0.75, feather: 0.0001, invert: 0, mode: 1,
        });
      },
    },

    // ── CARTE DE DEPLACEMENT : DEUX SCENARIOS, UN PAR MODE DE LECTURE ─────
    //
    // La carte est \`mireEncre\`, la meme que celle qui sert \`effet-texture\` — le
    // harnais n a pas d IPC, donc la bibliotheque est une mire GENEREE dans la
    // page. Elle convient par construction : deux echelles de structure (des
    // cellules de 32 px et des bandes diagonales) plus un detail au pixel, donc
    // des pentes lisibles a plusieurs finesses.
    //
    // ⚠️ \`ensureTextureLoaded\` est OBLIGATOIRE : \`viewFor\` ne bloque pas, il sert
    // le repli 1x1 et rend la main. Sans l attente, l effet prendrait sa branche
    // de repli et rendrait l image INCHANGEE — une reference qui ressemble a une
    // reference, et qui ne verrouille rien. Le garde de signal l a deja attrape
    // une fois sur \`effet-texture\`.

    // PENTE DU GRIS, le defaut : la carte est un relief, le decalage suit sa
    // pente. C est le mode qui marche avec ce que la bibliotheque CONTIENT — des
    // scans, donc des images grises.
    "effet-deplacement-pente": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        r.setTextureCatalog([TEXTURE_MIRE]);
        await r.ensureTextureLoaded(0);
        const a = stack.addLayer("displacementMap");
        stack.updateParams(a, { rang: 0, mode: 0, amplitude: 60, echelle: 0.8, angle: 12, finesse: 4 });
      },
    },

    // CANAUX R ET V, la convention Photoshop. Contre le mode Pente, tout le
    // reste identique : l ecart EST la facon de lire la carte, et rien d autre.
    //
    // Sur une carte GRISE, ce mode pousse tout en diagonale a 45 degres, R et V
    // y etant egaux — ce n est pas un defaut du scenario, c est la raison pour
    // laquelle il n est pas le defaut de l effet, et cette reference le montre.
    "effet-deplacement-canaux": {
      contre: "effet-deplacement-pente",
      build: async (r, stack) => {
        r.setTextureCatalog([TEXTURE_MIRE]);
        await r.ensureTextureLoaded(0);
        const a = stack.addLayer("displacementMap");
        stack.updateParams(a, { rang: 0, mode: 1, amplitude: 60, echelle: 0.8, angle: 12, finesse: 4 });
      },
    },

    // SOURCE IMAGE : la carte est l entree de l effet, pas un scan. L image se
    // deforme selon son propre relief tonal.
    //
    // AUCUN setTextureCatalog, AUCUN ensureTextureLoaded, ET C EST LA PROPRIETE
    // VERROUILLEE. Les deux scenarios ci-dessus en ont besoin sous peine de
    // rendre l image inchangee ; celui-ci doit rendre une image DEPLACEE avec un
    // catalogue vide, le binding 7 servant sa texture de repli 1x1 qu on ne lit
    // pas. Un jour ou la garde de repli redeviendrait inconditionnelle, ce
    // scenario rendrait l image nue et son ecart contre la photo tomberait a
    // zero — c est exactement ce que le harnais refuse.
    //
    // Echelle 1 et angle 0 : la carte EST l image alignee sur elle-meme, le cas
    // d usage. Mode 0 (pente du gris), le defaut, qui lit la meme luminance que
    // sur un scan.
    "effet-deplacement-image": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const a = stack.addLayer("displacementMap");
        stack.updateParams(a, { mode: 0, source: 1, amplitude: 60, echelle: 1, angle: 0, finesse: 4 });
      },
    },

    // ── NETTETE : QUATRE SCENARIOS, TROIS PROPRIETES ─────────────────────
    //
    // SUR \`mireBruit\`, ET CE CHOIX EST LA MOITIE DU VERROU. Cet effet a trois
    // choses a montrer, et il faut une mire qui porte les trois : deux MARCHES
    // franches d orientations differentes (l accentuation se lit sur un bord, et
    // un biais d orientation se verrait), et des plages PLATES faiblement
    // bruitees (+-3 %) — sans elles, le masquage n aurait rien a epargner et son
    // curseur ne bougerait aucun canal. La mire commune n a pas de plage plate :
    // son damier saute d un texel a l autre partout.
    //
    // ⚠️ C est exactement le piege de \`lensBlur\` (dix-sept tests verts sur un
    // flou au double du rayon), pris par l autre bout : ici la propriete est un
    // ECART LOCAL, donc la mire doit porter du plat ET du bord.

    // TEMOIN : la mire seule, sans effet. Les trois suivants s y comparent, donc
    // l ecart mesure est ce que l effet AJOUTE, et rien d autre.
    "effet-nettete-temoin": {
      fond: false,
      build: async (r, stack) => {
        const bruit = await mireBruit(W, H);
        const sourceId = await r.photoSources.register(bruit);
        stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bruit");
      },
    },

    // ACCENTUATION : la bande haute. Les sept passes de pyramide sont ETEINTES
    // (\`EffectPass.enabled\`), donc \`prevPass\` est la source elle-meme et le flou
    // se fait en tente 3x3 dans la passe finale. Ce scenario verrouille donc
    // aussi ce branchement-la, qui n a aucun autre temoin : si les passes
    // cessaient d etre sautees, le flou deviendrait large et l image changerait
    // partout.
    "effet-nettete-accentuation": {
      fond: false,
      contre: "effet-nettete-temoin",
      build: async (r, stack) => {
        const bruit = await mireBruit(W, H);
        const sourceId = await r.photoSources.register(bruit);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bruit");
        const a = stack.addLayer("nettete", p);
        stack.updateParams(a, { bande: 0, force: 1.6, rayon: 1, masquage: 0, halos: 0.9 });
      },
    },

    // CLARTE : la meme dose, la meme maitrise, le meme masquage — SEULE la bande
    // change. L ecart entre les deux images EST donc le rayon du flou, et rien
    // d autre. C est le couple qui attrape une pyramide qui ne tournerait pas,
    // ou un \`rayon\` cable au mauvais index dans le noyau de remontee.
    "effet-nettete-clarte": {
      fond: false,
      contre: "effet-nettete-accentuation",
      build: async (r, stack) => {
        const bruit = await mireBruit(W, H);
        const sourceId = await r.photoSources.register(bruit);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bruit");
        const a = stack.addLayer("nettete", p);
        stack.updateParams(a, { bande: 1, force: 1.6, rayon: 2, masquage: 0, halos: 0.9 });
      },
    },

    // MASQUAGE : la meme accentuation, mais les plages plates epargnees. L ecart
    // se concentre par construction dans le bruit des deux paliers, PAS sur les
    // deux marches — c est la propriete meme du controle. Un masquage cable a
    // l envers (qui epargnerait les bords) rendrait un ecart du meme ordre, mais
    // au mauvais endroit : c est ce que la relecture de l image tranche, la ou le
    // pourcentage ne le pourrait pas.
    "effet-nettete-masquage": {
      fond: false,
      contre: "effet-nettete-accentuation",
      build: async (r, stack) => {
        const bruit = await mireBruit(W, H);
        const sourceId = await r.photoSources.register(bruit);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bruit");
        const a = stack.addLayer("nettete", p);
        stack.updateParams(a, { bande: 0, force: 1.6, rayon: 1, masquage: 0.5, halos: 0.9 });
      },
    },

    // ── LES SIX MODES DE FUSION DU 2026-08-18 (ticket 12, tranche 1) ──────
    //
    // Le registre en portait onze et n en verrouillait que TROIS, tous en
    // passagers d un scenario d effet (\`screen\`, \`overlay\`, \`multiply\`). Les six
    // qui arrivent sont les quatre non separables et les deux signes.
    //
    // MONTAGE COMMUN : la mire a bandes en calque photo par-dessus le fond, et
    // rien d autre. Aucun effet dans la pile — ce qu on verrouille est le
    // COMPOSITING, et un effet interpose melangerait sa propre reponse a la
    // mesure. C est la raison pour laquelle ces scenarios ne reutilisent pas
    // \`photo-double-exposure\`, qui porte un \`lensDistortion\` en passager.
    //
    // CHAINE DES \`contre\`, et c est le point du montage : chacun se mesure
    // contre le scenario dont il doit se DISTINGUER, pas contre la photo nue.
    // Un \`contre\` sur la photo nue prouverait seulement que le mode agit ; ici
    // l ecart mesure repond a la question qui separe deux modes voisins.

    // COULEUR : chromaticite du dessus, luminosite du dessous.
    // Contre la photo nue, parce que c est le premier de la chaine.
    "fusion-couleur": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const bandes = await mireFusion(W, H);
        const sourceId = await r.photoSources.register(bandes);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bandes");
        at(stack, p).blendMode = "color";
      },
    },

    // LUMINOSITE : l EXACT INVERSE du precedent — luminosite du dessus,
    // chromaticite du dessous. Meme montage au mode pres, donc l ecart entre
    // les deux images EST le sens de la reprise, et rien d autre. Deux modes
    // branches sur la meme moitie rendraient un ecart nul ici, et c est le
    // defaut le plus facile a commettre en recopiant quatre formules qui ne
    // different que par l ordre de leurs arguments.
    "fusion-luminosite": {
      contre: "fusion-couleur",
      build: async (r, stack) => {
        const bandes = await mireFusion(W, H);
        const sourceId = await r.photoSources.register(bandes);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bandes");
        at(stack, p).blendMode = "luminosity";
      },
    },

    // TEINTE : teinte du dessus, mais saturation ET luminosite du dessous.
    // Contre COULEUR, qui prend la teinte AVEC la saturation : leur seul ecart
    // est donc l origine de la saturation. Sur la bande grise du dessus, les
    // deux doivent converger vers du neutre (une teinte sans saturation n est
    // pas une teinte) — ce qui borne l ecart par en haut et le rend lisible.
    "fusion-teinte": {
      contre: "fusion-couleur",
      build: async (r, stack) => {
        const bandes = await mireFusion(W, H);
        const sourceId = await r.photoSources.register(bandes);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bandes");
        at(stack, p).blendMode = "hue";
      },
    },

    // SATURATION : saturation du dessus, teinte et luminosite du dessous.
    // Contre TEINTE, dont il est le complementaire exact sur les deux memes
    // attributs. C est le couple qui attrape une inversion d arguments dans
    // \`blend_set_sat\`, que le couple Couleur/Luminosite ne verrait pas.
    "fusion-saturation": {
      contre: "fusion-teinte",
      build: async (r, stack) => {
        const bandes = await mireFusion(W, H);
        const sourceId = await r.photoSources.register(bandes);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bandes");
        at(stack, p).blendMode = "saturation";
      },
    },

    // DIFFERENCE : abs(dessous - dessus), en LUMIERE et non en valeurs codees
    // (voir l en-tete du groupe signe dans \`render/blend/modes.ts\`). La mire de
    // fond porte a la fois un disque creme tres clair et des rayures presque
    // noires, donc les deux sens de la soustraction sont exerces par
    // construction — c est ce que la paire suivante exploite.
    "fusion-difference": {
      contre: "photo-de-fond-seule",
      build: async (r, stack) => {
        const bandes = await mireFusion(W, H);
        const sourceId = await r.photoSources.register(bandes);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bandes");
        at(stack, p).blendMode = "difference";
      },
    },

    // SOUSTRACTION : max(dessous - dessus, 0). Contre DIFFERENCE, dont elle ne
    // se distingue QUE la ou le dessus depasse le dessous — partout ailleurs
    // les deux formules rendent le meme octet. L ecart mesure est donc
    // exactement la surface ou la valeur absolue a replie une valeur negative,
    // et un mode qui aurait recopie l autre rendrait zero pour cent.
    "fusion-soustraction": {
      contre: "fusion-difference",
      build: async (r, stack) => {
        const bandes = await mireFusion(W, H);
        const sourceId = await r.photoSources.register(bandes);
        const p = stack.addPhotoLayer(sourceId, { x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0 }, "bandes");
        at(stack, p).blendMode = "subtract";
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
      // Troisieme argument : le port de DECODAGE de texture. Le harnais n a pas
      // d IPC, donc il fournit sa mire generee au lieu de lire un fichier.
      // Quatrieme argument : L HORLOGE DE L OVERLAY, fixee a zero. Le contour
      // du safelight est pointille et sa phase avance avec le temps ; a
      // horloge libre, deux lectures de la meme pile different sur les
      // pointilles et le garde de reproductibilite du harnais rougit — a juste
      // titre. C est ce qui rendait l overlay non verrouillable, et la seule
      // raison pour laquelle il n avait aucune reference.
      const r = new Renderer(pass.ctx, undefined, async () => mireEncre(512, 512), () => 0);
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
        // L OVERLAY SE POSE APRES normalize, ET C EST OBLIGATOIRE : normalize
        // REECRIT les ids de calque en L0, L1... pour que deux passes du meme
        // scenario ne different pas par un compteur de module. Un id capture
        // dans build serait donc perime, l overlay ne trouverait aucun calque
        // et rendrait exactement l image du temoin — un scenario vert et
        // aveugle. Le scenario declare donc l id NORMALISE (L1 = le premier
        // calque pose au-dessus du fond).
        if (scenario.overlay) r.setMaskOverlay(scenario.overlay);
        // ETAGE DE DEVELOPPEMENT (ticket 03) : un champ develop du scenario
        // devient les reglages de l etage, appliques au composite en fin de
        // chaine. Pose sur le renderer pour le chemin CANVAS (render), et passe
        // en parametre a exportFrame pour le chemin EXPORT. Absent -> etage au
        // defaut, aucune passe emise, rendu inchange au bit pres.
        const develop = scenario.develop ?? {};
        r.setDevelop(develop);
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
          : () => r.exportFrame(layers, scenario.cadre ?? null, develop);
        const first = await read();
        // Deuxieme lecture sur le MEME renderer : separe une instabilite de
        // frame (cache de pipeline, epoque de masque) d'une instabilite de
        // mise en place (device, upload de texture).
        const second = await read();
        let intra = 0;
        for (let i = 0; i < first.pixels.length; i++) if (first.pixels[i] !== second.pixels[i]) intra++;
        // PREUVE QUE RIEN N EST EVALUE DANS L ESPACE DU CADRE. L export cadre
        // doit etre le crop OCTET POUR OCTET du sous-rectangle de l export PLEIN
        // de la MEME pile — sinon un degrade, un masque ou une transform aurait
        // glisse avec le cadre (ticket 28, second defaut silencieux). On
        // recompose la toile entiere et on decoupe cote JS avec le cadre brut,
        // independamment de \`regionDeLecture\` du produit.
        if (scenario.cadre && scenario.surface !== "canvas") {
          const c = scenario.cadre;
          const plein = await r.exportFrame(layers, null, develop);
          const fw = plein.width;
          let diff = 0;
          let premier = -1;
          for (let row = 0; row < c.height; row++) {
            const baseA = ((c.y + row) * fw + c.x) * 4;
            const baseB = row * c.width * 4;
            for (let k = 0; k < c.width * 4; k++) {
              if (plein.pixels[baseA + k] !== first.pixels[baseB + k]) {
                diff++;
                if (premier < 0) premier = baseB + k;
              }
            }
          }
          if (diff !== 0) {
            return JSON.stringify({
              ok: false,
              error: "cadre " + id + " : export cadre != crop de l export plein (" + diff + " octets, premier @" + premier + ")",
            });
          }
        }
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
    // EPROUVE UNE DECLARATION « Sans objet » (Task 1 du plan de
    // rationalisation des controles). Trois rendus sur la MEME configuration :
    // la photo de fond seule, puis l'effet avec le parametre au minimum, puis
    // au maximum.
    //
    // Deux chiffres sortent, et le second n'est pas decoratif. « Zero ecart
    // entre min et max » a DEUX causes : le curseur est inerte, ou l'effet
    // entier ne fait rien dans cette configuration. Sans le second chiffre
    // (l'ecart contre le fond) la sonde rendrait « inerte » sur un effet
    // eteint — le defaut meme que \`verifierSignal\` corrige plus bas.
    async applicabilite(json) {
      const s = JSON.parse(json);
      const mires = {
        mire: () => mire(W, H, 0),
        mireBokeh: () => mireBokeh(W, H),
        mireRampe: () => mireRampe(W, H),
        mireBarres: () => mireBarres(W, H),
        mireBruit: () => mireBruit(W, H),
        mireLampes: () => mireLampes(W, H),
        mireDamierNeutre: () => mireDamierNeutre(W, H),
        mireVerre: () => mireVerre(W, H),
      };
      if (!mires[s.mire]) return JSON.stringify({ ok: false, error: "mire inconnue: " + s.mire });
      const r = new Renderer(pass.ctx);
      try {
        await r.loadImage(await mires[s.mire](), { width: W, height: H });
        // \`openDocument\` est pur : il relit l'etat du renderer et rend une pile
        // NEUVE. Trois appels sur le meme renderer ne s'accumulent donc pas.
        const rendre = async (params) => {
          const stack = openDocument(r, "fond").stack;
          if (params) stack.updateParams(stack.addLayer(s.effet), params);
          return (await r.exportFrame(normalize(stack))).pixels;
        };
        const fond = await rendre(null);
        const bas = await rendre(Object.assign({}, s.base, { [s.param]: s.a }));
        const haut = await rendre(Object.assign({}, s.base, { [s.param]: s.b }));
        const ecart = (x, y) => {
          let n = 0, max = 0;
          for (let i = 0; i < x.length; i++) {
            const d = Math.abs(x[i] - y[i]);
            if (d) { n++; if (d > max) max = d; }
          }
          return { n, max };
        };
        const curseur = ecart(bas, haut);
        const signal = ecart(bas, fond);
        return JSON.stringify({
          ok: true,
          canaux: bas.length,
          curseur: curseur.n,
          curseurMax: curseur.max,
          signal: signal.n,
          signalMax: signal.max,
          largeur: W,
          hauteur: H,
          // Les octets ne repartent que si on les demande : une reponse CDP
          // par configuration reste petite dans le cas courant.
          imageBas: s.images ? b64(bas) : null,
          imageHaut: s.images ? b64(haut) : null,
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
      Object.entries(scenarios).map(([id, s]) => [id, { valeurs: s.valeurs ?? null, contre: s.contre ?? null, identiqueA: s.identiqueA ?? null }]),
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
    const attente = meta.attentes[id] ?? { valeurs: null, contre: null, identiqueA: null };
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

    // IDENTITE EXIGEE (ticket 03) : un scenario qui declare `identiqueA` doit
    // rendre EXACTEMENT les memes pixels qu un autre. Sert a prouver que l etage
    // de developpement (etalonnage applique au composite) rend bit pour bit ce
    // que rend le meme effet pose en CALQUE — deux chemins, un seul resultat.
    if (attente.identiqueA) {
      const ref = results[attente.identiqueA];
      if (!ref) {
        notes.push(`identite vs ${attente.identiqueA} non mesuree (hors de ce --scenario)`);
      } else {
        const stats = comparePixels(pixels, ref.pixels);
        if (stats.differing !== 0) {
          bon = false;
          notes.push(`DIFFERE de ${attente.identiqueA} sur ${stats.differing} canaux (attendu: identique)`);
        } else {
          notes.push(`identique a ${attente.identiqueA}, au bit pres`);
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

/** Part de canaux en dessous de laquelle une CONFIGURATION est jugee morte —
 *  l'effet n'y fait rien, donc elle ne peut rien dire du curseur. Cale sur le
 *  meme raisonnement que `MIN_PART_SIGNAL` et sur la meme mesure. */
const MIN_SIGNAL_CONFIG = 0.03;

/**
 * TASK 1 du plan de rationalisation des controles : eprouver les 39
 * declarations « Sans objet » au lieu de les croire.
 *
 * Trois verdicts, et le troisieme est celui qui rend la sonde honnete :
 *  - INERTE      le curseur ne deplace aucun canal, et l'effet AGIT bien ici ;
 *  - VIVANT      le curseur deplace des canaux la ou l'infobulle dit qu'il
 *                n'en deplace aucun. C'est un defaut trouve, pas un resultat
 *                de mesure : soit l'infobulle ment, soit le shader a un trou ;
 *  - NON CONCLUANT  l'effet ne fait rien dans cette configuration, donc
 *                l'absence d'ecart ne prouve rien du curseur. Sans ce verdict
 *                la sonde rendrait « inerte » sur un effet eteint.
 */
async function eprouverApplicabilite(cdp) {
  const { DECLARATIONS } = await import("./applicabilite-table.mjs");
  const declarations = DECL_ONLY ? DECLARATIONS.filter((d) => d.id === DECL_ONLY) : DECLARATIONS;
  if (declarations.length === 0) throw new Error(`Declaration inconnue: ${DECL_ONLY}`);

  const mesures = declarations.reduce((n, d) => n + d.configs.length, 0);
  console.log(
    `Applicabilite : ${declarations.length} declaration(s), ${mesures} configuration(s), ` +
      "3 rendus chacune (fond, min, max).\n",
  );
  await cdp.evaluate("window.__renderCheck.openPass()");

  const verdicts = [];
  for (const d of declarations) {
    const lignes = [];
    let inerte = true;
    let concluant = false;
    for (const c of d.configs) {
      const spec = { effet: d.effet, mire: d.mire, base: c.base, param: d.param, a: d.a, b: d.b, images: Boolean(IMAGES) };
      const raw = JSON.parse(
        await cdp.evaluate(`window.__renderCheck.applicabilite(${JSON.stringify(JSON.stringify(spec))})`),
      );
      if (!raw.ok) {
        lignes.push({ label: c.label, etat: "ERREUR", detail: raw.error.split("\n")[0] });
        inerte = false;
        continue;
      }
      if (IMAGES && raw.imageBas) {
        mkdirSync(IMAGES, { recursive: true });
        const nom = `${d.id}--${c.label}`.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
        for (const [suffixe, b64Pixels, valeur] of [["min", raw.imageBas, d.a], ["max", raw.imageHaut, d.b]]) {
          const octets = Buffer.from(b64Pixels, "base64");
          const fichier = path.join(IMAGES, `${nom}--${suffixe}-${valeur}.png`);
          writeFileSync(fichier, encodePng(octets, raw.largeur, raw.hauteur));
          console.log(`  image  ${path.relative(process.cwd(), fichier)}`);
        }
      }
      const partSignal = raw.signal / raw.canaux;
      const partCurseur = raw.curseur / raw.canaux;
      if (partSignal < MIN_SIGNAL_CONFIG) {
        lignes.push({
          label: c.label,
          etat: "MUET",
          detail: `l'effet ne deplace que ${(partSignal * 100).toFixed(3)} % des canaux — configuration morte`,
        });
        inerte = false;
        continue;
      }
      concluant = true;
      if (raw.curseur === 0) {
        lignes.push({ label: c.label, etat: "inerte", detail: `effet actif sur ${(partSignal * 100).toFixed(1)} % des canaux` });
      } else {
        inerte = false;
        lignes.push({
          label: c.label,
          etat: "VIVANT",
          detail: `${raw.curseur} canaux (${(partCurseur * 100).toFixed(3)} %), max ${raw.curseurMax}`,
        });
      }
    }
    const verdict = lignes.some((l) => l.etat === "ERREUR")
      ? "ERREUR"
      : lignes.some((l) => l.etat === "VIVANT")
        ? "VIVANT"
        : !concluant || lignes.some((l) => l.etat === "MUET")
          ? "NON CONCLUANT"
          : "inerte";
    verdicts.push({ id: d.id, verdict, declare: d.declare, lignes });
  }
  await cdp.evaluate("window.__renderCheck.closePass()");

  for (const v of verdicts) {
    const tag = v.verdict === "inerte" ? "OK    " : v.verdict === "VIVANT" ? "VIVANT" : "?     ";
    console.log(`${tag} ${v.id.padEnd(28)} ${v.verdict === "inerte" ? "" : v.verdict}`);
    for (const l of v.lignes) console.log(`         ${l.etat.padEnd(7)} ${l.label.padEnd(22)} ${l.detail}`);
  }

  const compte = (q) => verdicts.filter((v) => v.verdict === q).length;
  console.log(
    `\nInertes ${compte("inerte")} · VIVANTS ${compte("VIVANT")} · non concluants ` +
      `${compte("NON CONCLUANT")} · erreurs ${compte("ERREUR")} — sur ${verdicts.length} declarations.`,
  );
  if (compte("VIVANT")) {
    console.log(
      "\nUn VIVANT n'est pas un echec de la sonde : c'est une infobulle qui ment ou un\n" +
        "shader qui a un trou. Les deux se tranchent a la main, pas au harnais.",
    );
  }
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

  if (APPLICABILITE) return await eprouverApplicabilite(cdp);

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
