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
  "toile-vide.png": { valeurs: 1 },
  "toile-damier.png": { valeurs: 2 },
  "photo-de-fond-seule.png": { valeurs: null },
  "effets-glow-posterize.png": { valeurs: null },
  "grain-graine-fixe.png": { valeurs: null },
  "photo-double-exposure.png": { valeurs: null },
  "masque-pinceau-degrade.png": { valeurs: null },
  "masque-edge-aware.png": { valeurs: null },
  // Meme chaine edge-aware, mais sur le calque le PLUS BAS (le calque photo de
  // fond). Le scenario ci-dessus la posait sur un calque d'effet en position 1,
  // dont le guide etait deja le composite en dessous : il ne pouvait pas voir
  // que le guide du calque du bas etait la toile VIDE. Voir
  // docs/adr/0004-image-de-guide-du-masque-edge-aware.md.
  "masque-edge-aware-calque-du-bas.png": { valeurs: null },
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
      expect(image.width).toBe(256);
      expect(image.height).toBe(256);

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
});
