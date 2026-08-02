import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "../../scripts/lib/png.mjs";

/**
 * GARDE SANS GPU SUR LES REFERENCES DE RENDU.
 *
 * `npm run test:render` est la seule preuve de non-regression du rendu, mais
 * il exige une fenetre WebView2 vivante et un Vite : il ne tourne pas en
 * pre-commit, et personne ne l'a lance entre le merge du harnais (matin du
 * 2026-07-28) et celui de la tranche T1 (soir), qui l'a casse. Les six
 * references sont restees rouges un jour entier sans que rien ne le dise.
 *
 * Le scenario redoute n'est PAS celui-la (un harnais rouge finit par se voir)
 * mais le suivant : un `--update` de bonne foi qui fige des images MORTES en
 * references. Le harnais redevient vert et n'a plus rien a detecter. Mesure du
 * 2026-07-29 : avec la toile videe par T1, cinq scenarios sur six ne bougeaient
 * plus d'un seul canal quand on perturbait volontairement le pipeline.
 *
 * Ce fichier ne rend rien : il RELIT ce qui est committe. Il tourne dans
 * `npm run test`, donc dans le pre-commit, donc sur chaque tranche — et il
 * echoue si une reference est une image ecrasee. C'est la moitie du garde-fou
 * qui n'a pas besoin d'un GPU ; l'autre moitie (la gate de signal) vit dans
 * `scripts/render-check.mjs` et s'oppose a l'ecriture, celle-ci s'oppose au
 * commit.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF_DIR = path.join(HERE, "..", "render-refs");

/** Le contrat des scenarios, en dur : renommer/ajouter un scenario doit etre
 *  un geste CONSCIENT qui casse ce test, jamais un fichier qui apparait. */
const ATTENDU = {
  "toile-vide.png": { width: 256, height: 256, valeurs: 1 },
  "toile-damier.png": { width: 256, height: 256, valeurs: 2 },
  "photo-de-fond-seule.png": { width: 256, height: 256, valeurs: null },
  "effets-glow-posterize.png": { width: 256, height: 256, valeurs: null },
  "grain-graine-fixe.png": { width: 256, height: 256, valeurs: null },
  "photo-double-exposure.png": { width: 256, height: 256, valeurs: null },
  "masque-pinceau-degrade.png": { width: 256, height: 256, valeurs: null },
  "masque-edge-aware.png": { width: 256, height: 256, valeurs: null },
  // Meme chaine edge-aware, mais sur le calque le PLUS BAS (le calque photo de
  // fond). Le scenario ci-dessus la posait sur un calque d'effet en position 1,
  // dont le guide etait deja le composite en dessous : il ne pouvait pas voir
  // que le guide du calque du bas etait la toile VIDE. Voir
  // docs/adr/0004-image-de-guide-du-masque-edge-aware.md.
  "masque-edge-aware-calque-du-bas.png": { width: 256, height: 256, valeurs: null },
  // LENS BLUR (2026-08-01), et DEUX references pour un seul effet — ce n'est
  // pas une redondance. La premiere pose l'effet sur la mire commune : elle
  // verrouille la geometrie de champ (iris) et le raccord net/flou. La seconde
  // est un TEMOIN DE BOKEH sur des points lumineux isoles, et elle existe
  // parce que la premiere ne peut PAS voir la propriete principale de l'effet :
  // une tache de bokeh ne se lit que sur un petit point brillant contre du
  // sombre, et sous un damier un lens blur rend la meme chose qu'un gaussien.
  // Elle a paye son cout des sa premiere execution, en attrapant deux defauts
  // qu'aucun des dix-sept tests unitaires de l'effet ne voyait : un rayon
  // applique au double de sa valeur, et une collecte trop clairsemee qui
  // rendait des nuees granuleuses au lieu d'hexagones.
  "effet-lens-blur.png": { width: 256, height: 256, valeurs: null },
  "effet-lens-blur-bokeh.png": { width: 256, height: 256, valeurs: null },
  // HATCHING (2026-08-01) : pose sur une rampe de gris NEUTRE et non sur la
  // mire commune, pour la meme raison que le temoin de bokeh a sa propre mire.
  // Le sujet de cet effet est sa REPONSE TONALE — trois couches de tailles qui
  // se relaient quand la precedente sature — et le damier de la mire commune
  // ferait sauter la luminance d'un texel a l'autre, rendant la progression
  // illisible. Une reference qui ne peut pas voir ce que l'effet pretend faire
  // ne verrouille que son bruit.
  "effet-hatching.png": { width: 256, height: 256, valeurs: null },
  // OUTLINES (2026-08-01) : cette reference a ete posee AVANT l extraction du
  // gradient de Scharr vers `effects/edgeGradient.ts`, precisement pour rendre
  // cette extraction prouvable. L effet n avait aucun verrou de pixels alors
  // que sa sortie depend d un noyau 3x3 sur huit taps, d une mesure de
  // chromaticite et d un plancher fwidth — rien n aurait vu une derive de l un
  // des trois. Elle reste ensuite comme verrou permanent. Sensibilite couleur a
  // 0.8 : la mire porte des damiers colores de meme luminance, donc le second
  // gradient est reellement sollicite.
  "effet-outlines.png": { width: 256, height: 256, valeurs: null },
  // COLORED EDGES (2026-08-01) : la mire COMMUNE suffit, et c est assez rare
  // pour etre dit. Son disque en hautes lumieres est un contour FERME, donc il
  // parcourt tout le cercle des orientations, donc toute la roue chromatique —
  // exactement la propriete que cet effet pretend porter. Un damier seul
  // n aurait montre que quatre teintes (ses bords sont a 0 et 90 degres, dans
  // les deux sens) et n aurait pas prouve la continuite.
  "effet-colored-edges.png": { width: 256, height: 256, valeurs: null },
  // MOTION BLUR (2026-08-01) : mode ROTATION et non Directionnel. C est le seul
  // des trois dont une propriete se VERIFIE d un coup d oeil — la longueur de
  // trainee est proportionnelle au rayon, donc le centre reste net sans qu
  // aucun reglage ne le demande. Un file directionnel rend la meme chose
  // partout, et une reference posee dessus ne distinguerait pas un motion blur
  // d un flou quelconque etire.
  "effet-motion-blur.png": { width: 256, height: 256, valeurs: null },
  // SURFACE BLUR (2026-08-01) : mire propre, parce qu un bilateral promet DEUX
  // choses a la fois — le bruit disparait, le contour survit — et qu aucune
  // mire existante ne porte les deux. Le damier n a que des contours (rien a
  // lisser), le degrade que des aplats (rien a preserver) : sur l un comme sur
  // l autre, un bilateral et un gaussien rendraient la meme chose et la
  // reference ne prouverait rien.
  "effet-surface-blur.png": { width: 256, height: 256, valeurs: null },
  // PIXEL STRETCH (2026-08-01) : premier verrou de cet effet, pose le jour ou
  // Antoine a releve qu il ne rendait pas celui de Figma. La comparaison sur
  // image a montre pourquoi — le notre etait GLOBAL et mangeait la photo en
  // bandes, le leur se place sur la toile. Le scenario verrouille donc la
  // REGION : ecart de 6,4 % des canaux contre 43,1 % sans elle, c est-a-dire
  // une mire intacte tout autour de la coulure.
  "effet-pixel-stretch.png": { width: 256, height: 256, valeurs: null },
  // WARP, TYPE ANALYTIQUE (2026-08-01). Le scenario masque-pinceau-degrade
  // couvre deja le chemin du BRUIT fractal ; celui-ci couvre l autre famille,
  // les huit formes centrees venues de la fiche Figma. Tourbillon plutot qu un
  // autre des huit : sa decroissance gaussienne se verifie d un coup d oeil.
  "effet-warp-tourbillon.png": { width: 256, height: 256, valeurs: null },
  // HALFTONE (2026-08-01) : la ROSETTE est la seule propriete qui distingue une
  // vraie trame d une grille de points, et elle n apparait qu en CMJN — les
  // quatre encres tramees a 15, 75, 0 et 45 degres. Une trame au meme angle
  // partout donne un moire, pas une rosette : c est donc ce que cette reference
  // verrouille, et rien d autre ne pourrait le voir.
  "effet-halftone.png": { width: 256, height: 256, valeurs: null },
  // ANAMORPHIC STREAK (2026-08-01) : sur la mire a POINTS LUMINEUX ISOLES, la
  // meme que le temoin de bokeh. Une trainee ne se lit que sur une source
  // ponctuelle contre du sombre ; sur un damier, l etalement directionnel se
  // confondrait avec un flou de mouvement. La reference a paye son cout des sa
  // premiere execution : elle a montre que la trainee PERLAIT en chapelet, un
  // trou structurel entre le nombre de taps et la croissance du pas.
  "effet-anamorphic-streak.png": { width: 256, height: 256, valeurs: null },
  // SLICE SHIFT (2026-08-02) : posee AVANT d ajouter le fondu des bords, pour
  // la meme raison qu outlines — l effet n avait aucun verrou, et « le nouveau
  // parametre a 0 ne change rien » serait reste une affirmation sans une
  // reference d avant le geste. Sur la RAMPE et non sur la mire commune : la
  // propriete a montrer est la MARCHE de valeur a la frontiere entre deux
  // tranches, et un damier saute deja d un texel a l autre, donc la marche s y
  // noierait. Mesure a l ecriture, colonne x=128 : quatre marches (y = 32, 128,
  // 192, 224, toutes multiples de l epaisseur de 32), transition sur UNE ligne
  // aux quatre. C est ce 1 que le fondu fait bouger.
  "effet-slice-shift.png": { width: 256, height: 256, valeurs: null },
  // SLICE SHIFT, FONDU A 16 PX (2026-08-02) : le SEUL couple de references du
  // dossier a ne differer que par un parametre, et c est delibere — meme mire,
  // meme graine, donc exactement les memes tranches aux memes endroits. Ce
  // couple est un A/B et pas deux images qui se ressemblent. Il porte le PROFIL
  // du fondu, et rien d autre : transition de 1 ligne a 13-15 aux memes y,
  // monotone aux quatre frontieres, coeur des tranches intact. Les trois sont
  // ASSERTEES plus bas, pas seulement decrites ici — sans quoi un `--update` de
  // bonne foi les effacerait en silence, ce que ce fichier existe pour empecher.
  //
  // ⚠️ CE QUE CE COUPLE NE PEUT PAS DIRE, et l avoir cru une premiere fois a
  // coute une revue : il ne decide PAS si le fondu melange des coordonnees ou
  // des couleurs. Sur une rampe AFFINE les deux sont algebriquement identiques
  // (`mix` commute avec un echantillonneur affine) ; seule la courbure du
  // transfert sRGB les separe, pour 0,03 niveau moyen. Le coeur intact n exclut
  // qu un flou GLOBAL, alors que le piege nomme dans la demande est une
  // operation LOCALE au bord — qui laisserait le coeur intact elle aussi.
  // C est `effet-slice-shift-fondu-barres.png` qui tranche ce point.
  "effet-slice-shift-fondu.png": { width: 256, height: 256, valeurs: null },
  // SLICE SHIFT SUR BARRES BINAIRES (2026-08-02) : la reference qui decide de la
  // NATURE du melange, et la seule qui le puisse. Barres de 16 px, deux niveaux,
  // uniformes en y et sur toute la largeur — donc deux lignes de decalages
  // differents echantillonnent un contenu statistiquement identique, et toute
  // valeur intermediaire est FABRIQUEE. Un melange de coordonnees ressort
  // toujours une valeur de la source (seuls les bords de barre sont
  // intermediaires) ; un melange de couleurs en fabrique partout ou les deux
  // copies different, soit des dizaines de pour cent. Mesure assertee plus bas.
  //
  // Le contraste, lui, ne discrimine PAS : un decalage fractionnaire passe par
  // une interpolation bilineaire qui attenue deja les hautes frequences, donc un
  // melange de coordonnees perd du contraste lui aussi (-25 % mesure sur les
  // rayures de 3 px de la mire commune, contre -29 % attendus d un melange de
  // couleurs — indiscernable). D ou une mire BINAIRE, ou l on compte une
  // population et pas une amplitude.
  "effet-slice-shift-fondu-barres.png": { width: 256, height: 256, valeurs: null },
  // MOTION BLUR, TRAINEE LONGUE (2026-08-02) : la reference qui exerce les DEUX
  // ETAGES de collecte, poses quand la plage est passee de 120 a 2000 px sur un
  // retour d Antoine (« pas assez extremes »). Rotation a 360 degres, ~800 px de
  // trainee au bord, donc CINQ segments — sous 192 px le second etage ne serait
  // pas sollicite et la reference ne verrouillerait que le chemin d avant.
  //
  // Le scenario porte aussi la preuve de la ROTATION VRAIE, et cette preuve est
  // analytique : integrer un tour complet, c est prendre la moyenne autour de
  // chaque cercle, donc le resultat exact est fait d anneaux CONSTANTS. Ecart-
  // type angulaire mesure, en part de la dynamique : 16 a 20 % avec l ancienne
  // approximation au premier ordre, 0,3 % avec la rotation exacte. Le seul
  // rayon qui depasse encore (5 % a r=60) est celui qui longe le bord du disque
  // en hautes lumieres de la mire — diffusion de reechantillonnage contre une
  // arete radiale, inherente a toute rotation multi-taps sur une grille.
  "effet-motion-blur-long.png": { width: 256, height: 256, valeurs: null },
  // GOOEY MERGE (2026-08-02) : posee pour repondre a une question d Antoine —
  // « tres aliasé effet metal avec des artefacts, c est le but ? » — et la
  // reponse est NON, mesuree. Part de transitions fortes qui se font en UN seul
  // pixel (donc sans aucun pixel de couverture partielle) : 50,0 % sur la mire
  // NUE, 74,3 % avec cet effet, contre 3,0 % pour halftone et 30,6 % pour
  // outlines sur la meme mire. L effet AJOUTE donc des aretes franches, alors
  // que son fichier annonce une iso-surface « antialiasee analytiquement a toute
  // tension ». Tension a 1 dans le scenario, deliberement : c est le pire cas.
  //
  // Premier essai ECARTE, et garde en memoire : pose sur la mire a points
  // lumineux isoles, l effet rendait 5 valeurs distinctes et le garde de signal
  // a refuse d ecrire la reference. Cette mire est presque entierement noire,
  // donc tout tombe du meme cote du seuil — un effet de seuil a besoin d un
  // champ qui TRAVERSE le seuil, pas de taches isolees.
  "effet-gooey-merge.png": { width: 256, height: 256, valeurs: null },
  // TRANCHE T2 : la SEULE reference dont la toile n'a pas la taille de la mire
  // (320 x 320 pour une mire de 256 x 256). Sa presence ici, avec des dimensions
  // differentes des neuf autres, est la trace qu'une reference n'est plus
  // forcement 256 x 256.
  "toile-plus-grande-que-la-photo.png": { width: 320, height: 320, valeurs: null },
};

/** Meme plancher que `MIN_COULEURS` dans `scripts/render-check.mjs`. */
const MIN_COULEURS = 64;

function couleursDistinctes(pixels) {
  const vues = new Set();
  for (let i = 0; i < pixels.length; i += 4) {
    vues.add((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3]);
    if (vues.size > 4096) break;
  }
  return vues.size;
}

describe("references de rendu committees", () => {
  it("le dossier contient exactement les references attendues", () => {
    const trouves = readdirSync(REF_DIR).filter((f) => f.endsWith(".png")).sort();
    expect(trouves).toEqual(Object.keys(ATTENDU).sort());
  });

  for (const [fichier, attente] of Object.entries(ATTENDU)) {
    it(`${fichier} est une image lisible, opaque et non ecrasee`, () => {
      const image = decodePng(readFileSync(path.join(REF_DIR, fichier)));
      expect(image.width).toBe(attente.width);
      expect(image.height).toBe(attente.height);

      // Toute reference sort d'une passe d'aplatissement : alpha 1 partout,
      // sur les deux surfaces. Un alpha qui fuit ici, c'est un JPEG noir en
      // aval (voir `assertOpaqueForJpeg`).
      let alphaMin = 255;
      for (let i = 3; i < image.pixels.length; i += 4) alphaMin = Math.min(alphaMin, image.pixels[i]);
      expect(alphaMin).toBe(255);

      const couleurs = couleursDistinctes(image.pixels);
      if (attente.valeurs !== null) expect(couleurs).toBe(attente.valeurs);
      else expect(couleurs).toBeGreaterThanOrEqual(MIN_COULEURS);
    });
  }

  // ADR-0006 : le fond d'un export est BLANC. Gardé SANS GPU, parce qu'un fond
  // d'export qui redeviendrait noir ne casserait aucun test unitaire de shader
  // (le WGSL n'est qu'une chaîne) et ne se verrait qu'en relançant le harnais.
  it("toile-vide est du BLANC opaque uniforme — le fond d'export d'ADR-0006", () => {
    const image = decodePng(readFileSync(path.join(REF_DIR, "toile-vide.png")));
    for (let i = 0; i < image.pixels.length; i += 4) {
      // Une seule assertion sur le premier pixel non conforme suffit à faire
      // rougir, mais boucler nomme LEQUEL — comme `assertOpaqueForJpeg`.
      if (
        image.pixels[i] !== 255 ||
        image.pixels[i + 1] !== 255 ||
        image.pixels[i + 2] !== 255 ||
        image.pixels[i + 3] !== 255
      ) {
        throw new Error(
          `pixel ${i / 4} = ${image.pixels.slice(i, i + 4).join(",")} au lieu de 255,255,255,255 ` +
            "— le fond d'export a cessé d'être blanc (ADR-0006).",
        );
      }
    }
  });

  // TRANCHE T2, le « done » de la tranche, gardé sans GPU : une photo de 256 x 256
  // centrée sur une toile de 320 x 320 laisse une bande de 32 px sur les quatre
  // côtés, et cette bande est BLANCHE dans le fichier exporté.
  it("toile-plus-grande-que-la-photo : la photo est centrée, le passe-partout est blanc", () => {
    const image = decodePng(readFileSync(path.join(REF_DIR, "toile-plus-grande-que-la-photo.png")));
    const at = (x, y) => {
      const i = (y * image.width + x) * 4;
      return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
    };
    const MARGE = (320 - 256) / 2;
    expect(MARGE).toBe(32);

    // Les quatre coins et le milieu de chaque bord : blanc pur.
    for (const [x, y] of [[0, 0], [319, 0], [0, 319], [319, 319], [160, 31], [160, 288], [31, 160], [288, 160]]) {
      expect(at(x, y)).toEqual([255, 255, 255]);
    }

    // Le premier pixel DANS la photo n'est pas blanc : la frontière tombe bien à
    // 32 px, la photo n'est ni décalée ni rééchelonnée.
    expect(at(MARGE, 160)).not.toEqual([255, 255, 255]);
    expect(at(320 - MARGE - 1, 160)).not.toEqual([255, 255, 255]);

    // La part de blanc pur vaut EXACTEMENT l'aire non couverte : 320² - 256².
    let blanc = 0;
    for (let i = 0; i < image.pixels.length; i += 4) {
      if (image.pixels[i] === 255 && image.pixels[i + 1] === 255 && image.pixels[i + 2] === 255) blanc++;
    }
    expect(blanc).toBe(320 * 320 - 256 * 256);
  });

  // Et la zone centrale est la MÊME image que le document nu : la photo n'a subi
  // aucun rééchantillonnage du fait de la toile plus grande. C'est la
  // non-régression que la tranche T2 devait prouver.
  it("la zone centrale reproduit photo-de-fond-seule à l'octet", () => {
    const grande = decodePng(readFileSync(path.join(REF_DIR, "toile-plus-grande-que-la-photo.png")));
    const nue = decodePng(readFileSync(path.join(REF_DIR, "photo-de-fond-seule.png")));
    let differents = 0;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const a = ((y + 32) * 320 + (x + 32)) * 4;
        const b = (y * 256 + x) * 4;
        for (let c = 0; c < 4; c++) if (grande.pixels[a + c] !== nue.pixels[b + c]) differents++;
      }
    }
    expect(differents).toBe(0);
  });

  /* ── SLICE SHIFT : le fondu des bords (2026-08-02) ──────────────────────────
   *
   * Les trois mesures ci-dessous vivaient en PROSE dans les commentaires
   * d'ATTENDU, et la revue adverse a eu raison de le relever : un `--update` de
   * bonne foi les aurait effacées sans rien faire rougir, ce qui est exactement
   * le scénario que l'en-tête de ce fichier dit vouloir empêcher. Elles sont
   * maintenant des assertions.
   */

  /** Canal vert de la colonne `x` d'une référence. Le vert est le seul canal que
   *  `chromaSplit` ne décale pas : ce qu'on y lit vient du décalage de tranche
   *  et de rien d'autre. */
  const colonneVerte = (fichier, x) => {
    const img = decodePng(readFileSync(path.join(REF_DIR, fichier)));
    return Array.from({ length: img.height }, (_, y) => img.pixels[(y * img.width + x) * 4 + 1]);
  };

  /** Nombre de lignes consécutives qui varient autour de `y0`. Une coupure
   *  franche en donne UNE, un fondu en donne autant que sa largeur. */
  const largeurTransition = (col, y0, rayon = 12) => {
    let n = 0;
    for (let y = y0 - rayon; y < y0 + rayon; y++) if (col[y] !== col[y + 1]) n++;
    return n;
  };

  // sliceSize 32 sur une toile de 256 : les frontières tombent aux multiples de
  // 32. Quatre d'entre elles portent une marche — les autres séparent deux
  // tranches immobiles (densité 0,5) ou fusionnées (irrégularité).
  const FRONTIERES = [32, 128, 192, 224];

  it("slice-shift : sans fondu, la frontière est une coupure d'UNE ligne", () => {
    const col = colonneVerte("effet-slice-shift.png", 128);
    for (const y0 of FRONTIERES) {
      expect(Math.abs(col[y0] - col[y0 - 1])).toBeGreaterThanOrEqual(4);
      expect(largeurTransition(col, y0)).toBe(1);
    }
  });

  it("slice-shift : avec un fondu de 16 px, la transition s'étale et reste monotone", () => {
    const col = colonneVerte("effet-slice-shift-fondu.png", 128);
    for (const y0 of FRONTIERES) {
      // Étalée : plus une coupure. La borne haute est celle de la bande de
      // fondu elle-même (16 px), pas un chiffre choisi après coup.
      const n = largeurTransition(col, y0);
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThanOrEqual(16);

      // Monotone : un fondu, pas une oscillation. Un profil non monotone
      // signalerait un pli — précisément ce que le choix de smoothstep évite.
      const signes = new Set();
      for (let y = y0 - 8; y < y0 + 8; y++) {
        const d = col[y + 1] - col[y];
        if (d !== 0) signes.add(Math.sign(d));
      }
      expect(signes.size).toBeLessThanOrEqual(1);
    }
  });

  it("slice-shift : le fondu ne touche QUE le bord — le cœur des tranches est intact", () => {
    const franc = decodePng(readFileSync(path.join(REF_DIR, "effet-slice-shift.png")));
    const fondu = decodePng(readFileSync(path.join(REF_DIR, "effet-slice-shift-fondu.png")));
    let compares = 0, differents = 0;
    for (let y = 0; y < 256; y++) {
      const local = y % 32;
      if (local < 12 || local > 20) continue; // cœur seul, hors bande de fondu
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4 + 1;
        compares++;
        if (franc.pixels[i] !== fondu.pixels[i]) differents++;
      }
    }
    expect(compares).toBe(18432);
    expect(differents).toBe(0);
  });

  it("slice-shift : le fondu est un FONDU ENCHAÎNÉ — les deux tranches coexistent dans la bande", () => {
    // ⚠️ CETTE ASSERTION A ÉTÉ INVERSÉE LE 2026-08-02, ET C'EST VOULU. Elle
    // exigeait d'abord le contraire (un mélange de COORDONNÉES, donc peu de
    // valeurs fabriquées) parce que la note accompagnant la demande d'Antoine
    // qualifiait le mélange de couleurs de piège. Antoine a jugé le résultat sur
    // pièce — « ça ressemble plus à du warping » — et un décalage qui varie
    // cisaille en effet le contenu au lieu d'adoucir la limite. C'est donc la
    // SPEC qui a changé, pas la mesure : le même instrument, la même mire, le
    // seuil retourné.
    //
    // La mire BINAIRE reste ce qui rend la question décidable : sur des barres
    // à deux niveaux, toute valeur intermédiaire est FABRIQUÉE. Un fondu
    // enchaîné en fabrique partout où les deux tranches décalées diffèrent ; un
    // mélange de coordonnées n'en fabriquerait qu'aux bords de barre.
    const img = decodePng(readFileSync(path.join(REF_DIR, "effet-slice-shift-fondu-barres.png")));
    const MARGE = 12;
    const intermediaire = (v) => Math.abs(v - 32) > MARGE && Math.abs(v - 224) > MARGE;

    let dedans = 0, dedansTot = 0, dehors = 0, dehorsTot = 0;
    for (let y = 0; y < img.height; y++) {
      // Bande de fondu : ±8 px autour des frontières. `n = y + 0.5 - 128`,
      // parce que l'axe des tranches est compté depuis le CENTRE de l'image.
      const n = y + 0.5 - img.height / 2;
      const l = ((n % 32) + 32) % 32;
      const bande = Math.min(l, 32 - l) < 8;
      for (let x = 0; x < img.width; x++) {
        const v = img.pixels[(y * img.width + x) * 4 + 1];
        if (bande) { dedansTot++; if (intermediaire(v)) dedans++; }
        else { dehorsTot++; if (intermediaire(v)) dehors++; }
      }
    }

    // LE SEUIL EST CALIBRÉ CONTRE L'AUTRE IMPLÉMENTATION, pas choisi. Le
    // mélange de coordonnées, mesuré sur cette même mire quand il était en
    // place, donnait 3,67 % ; le fondu enchaîné donne 26,25 %. Le seuil est
    // leur moyenne géométrique — 10 % — donc à peu près la même marge de
    // chaque côté. Ce test aurait ROUGI sur l'implémentation précédente, et
    // c'est ce qui en fait une mesure et pas une décoration.
    expect(dedans / dedansTot).toBeGreaterThan(0.1);

    // Et HORS de la bande, rien n'est fabriqué au-delà des bords de barre : le
    // fondu ne touche que la limite. Sans cette seconde borne, un effet qui
    // fondrait toute l'image passerait aussi.
    expect(dehors / dehorsTot).toBeLessThan(0.05);
  });
});
