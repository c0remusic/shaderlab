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
});
