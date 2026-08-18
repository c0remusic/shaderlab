import { describe, expect, it } from "vitest";
import { boiteVersTransform, transformVersBoite, type BoiteUv } from "../../src/ui/boxControl";

/**
 * L'ADAPTATEUR DE BOÎTE — ticket 25, débloqué par le ticket 17.
 *
 * `aplat` n'avait que son CENTRE manipulable sur l'image : largeur, hauteur et
 * rotation restaient au curseur, alors que Photoshop donne huit poignées et une
 * rotation au coin. Le ticket 25 était bloqué parce que `CanvasControl` n'a que
 * trois genres — `point`, `disk`, `axis` — et qu'aucun ne sait exprimer une
 * boîte redimensionnable avec rotation.
 *
 * ⚠️ LE QUATRIÈME GENRE N'A DEMANDÉ AUCUN MANIPULATEUR NEUF. `TransformHandles`
 * fait déjà exactement ça pour le calque photo — quatre coins, quatre côtés, une
 * rotation, plus le magnétisme et l'accès clavier. Une boîte d'`aplat` et une
 * photo transformée sont le MÊME objet dans deux systèmes d'unités : un centre,
 * deux demi-étendues, un angle.
 *
 * Ce module est ce changement d'unités, et rien d'autre. C'est ce qui rend le
 * genre `box` moins cher qu'une copie — et la copie aurait coûté plus que le
 * fichier, comme `edgeGradient.ts` et `blurChain.ts` l'ont déjà établi côté
 * rendu.
 */

/** Cadre de travail : une photo 3:2, comme la plupart des cas réels. */
const CADRE = { width: 6000, height: 4000 };

/** Boîte de référence : centrée un peu à gauche, 80 % × 60 %, tournée de 20°. */
const BOITE: BoiteUv = { centreX: 0.46, centreY: 0.52, largeur: 0.8, hauteur: 0.6, rotation: 20 };

describe("adaptateur de boîte", () => {
  it("place le centre en PIXELS du cadre", () => {
    const { transform } = boiteVersTransform(BOITE, CADRE);
    expect(transform.x).toBeCloseTo(0.46 * 6000, 9);
    expect(transform.y).toBeCloseTo(0.52 * 4000, 9);
  });

  it("mesure la boite en PIXELS, pour la donner comme si elle etait le contenu", () => {
    const { photoSize, transform } = boiteVersTransform(BOITE, CADRE);
    expect(photoSize).toEqual({ width: 0.8 * 6000, height: 0.6 * 4000 });
    // Au repos, aucune echelle : toute la mecanique existante s'applique sans
    // que la boite ait besoin de la comprendre.
    expect(transform.scaleX).toBe(1);
    expect(transform.scaleY).toBe(1);
  });

  it("convertit l'angle des DEGRES du curseur vers les RADIANS de la geometrie", () => {
    // Le piege du fichier : les confondre ne casse rien de visible tout de
    // suite, la boite tourne — d'un facteur 57.
    expect(boiteVersTransform(BOITE, CADRE).transform.rotation).toBeCloseTo(Math.PI / 9, 12);
  });

  it("fait l'aller-retour sans deriver", () => {
    const { transform, photoSize } = boiteVersTransform(BOITE, CADRE);
    const retour = transformVersBoite(transform, photoSize, CADRE);
    for (const cle of ["centreX", "centreY", "largeur", "hauteur", "rotation"] as const) {
      expect(retour[cle], cle).toBeCloseTo(BOITE[cle], 9);
    }
  });

  it("rend un redimensionnement : la largeur est le PRODUIT de la taille et de l'echelle", () => {
    // Le manipulateur ne touche jamais a `photoSize` — il change `scaleX`. Lire
    // la seule `photoSize` au retour rendrait une boite qui ne grandit jamais,
    // et le glissement paraitrait sans effet.
    const { transform, photoSize } = boiteVersTransform(BOITE, CADRE);
    const apres = transformVersBoite({ ...transform, scaleX: 1.5, scaleY: 0.5 }, photoSize, CADRE);
    expect(apres.largeur).toBeCloseTo(0.8 * 1.5, 9);
    expect(apres.hauteur).toBeCloseTo(0.6 * 0.5, 9);
  });

  it("borne la taille a un pixel : une boite nulle ne rend pas des poignees superposees", () => {
    const plate = boiteVersTransform({ ...BOITE, largeur: 0, hauteur: 0 }, CADRE);
    expect(plate.photoSize.width).toBe(1);
    expect(plate.photoSize.height).toBe(1);
  });

  it("laisse le centre sortir du cadre — un aplat peut deborder", () => {
    // `aplat` pose une couleur A COTE de la photo dans le cas 453 du cahier, et
    // son `centreX` va de -0,5 a 1,5. Ecreter ici rendrait ce cas inatteignable
    // au manipulateur alors qu'il l'est au curseur.
    const dehors = boiteVersTransform({ ...BOITE, centreX: 1.4 }, CADRE);
    expect(dehors.transform.x).toBeCloseTo(1.4 * 6000, 9);
  });
});
