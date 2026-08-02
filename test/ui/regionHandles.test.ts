import { describe, it, expect } from "vitest";
import {
  centerFromOverlayPoint,
  clampRegionCenter,
  clampRegionRadius,
  isotropicToScreen,
  radiusFromOverlayPoint,
  radiusHandlePosition,
  regionToOverlay,
} from "../../src/ui/regionHandles";
import { pixelStretch } from "../../src/render/effects/pixelStretch";

/**
 * Le piège de ce module est qu'il convertit DEUX unités différentes : le centre
 * est en UV (0..1 du cadre), le rayon est dans l'espace ISOTROPE de `uvSpace`
 * (pixels / sqrt(W*H)). Les confondre donne un manipulateur juste sur une image
 * CARRÉE et faux partout ailleurs — donc juste sur la mire de test et faux sur
 * toutes les photos réelles, qui sont en 3:2. C'est exactement le genre de
 * défaut qu'un test posé uniquement sur du carré laisserait passer, d'où le
 * format non carré partout ci-dessous.
 */

/** Une photo 3:2, et un canvas affiché à la moitié de sa taille. */
const BG = { width: 6000, height: 4000 };
const RECT = { left: 40, top: 12, width: 3000, height: 2000 };

describe("regionHandles — l'échelle isotrope", () => {
  it("un rayon de 0,5 couvre la moitié de sqrt(W*H), à l'échelle d'affichage", () => {
    // sqrt(6000*4000) = 4898,98 px image ; le canvas est à 0,5 px écran par px
    // image, donc l'unité isotrope vaut 2449,49 px écran.
    expect(isotropicToScreen(BG, RECT)).toBeCloseTo(Math.sqrt(6000 * 4000) * 0.5, 3);
  });

  it("sur une image CARRÉE, l'unité isotrope est le côté — le cas qui masque le bug", () => {
    const carre = { width: 1000, height: 1000 };
    const rect = { left: 0, top: 0, width: 1000, height: 1000 };
    // aspectScale vaut (1,1) : c'est ici que traiter le rayon comme une
    // fraction d'UV donnerait la même réponse, et nulle part ailleurs.
    expect(isotropicToScreen(carre, rect)).toBeCloseTo(1000, 6);
  });
});

describe("regionHandles — dessiner le disque", () => {
  it("le centre en UV tombe sur le rectangle affiché, décalage compris", () => {
    const d = regionToOverlay({ x: 0.5, y: 0.5 }, 0.1, BG, RECT);
    expect(d.cx).toBeCloseTo(40 + 1500, 6);
    expect(d.cy).toBeCloseTo(12 + 1000, 6);
  });

  it("le disque reste un DISQUE sur une image non carrée", () => {
    // Le vrai test de la convention : on part du cercle dessiné, on repart de
    // deux points de son bord — l'un à l'horizontale, l'autre à la verticale —
    // et les deux doivent redonner le MÊME rayon. Avec un rayon traité en UV,
    // le second vaudrait 1,5 fois le premier sur ce 3:2.
    const centre = { x: 0.5, y: 0.5 };
    const d = regionToOverlay(centre, 0.2, BG, RECT);
    const horizontal = radiusFromOverlayPoint(d.cx + d.r, d.cy, centre, BG, RECT);
    const vertical = radiusFromOverlayPoint(d.cx, d.cy + d.r, centre, BG, RECT);
    expect(horizontal).toBeCloseTo(0.2, 6);
    expect(vertical).toBeCloseTo(0.2, 6);
  });

  it("dessiner puis relire le centre est l'identité", () => {
    const centre = { x: 0.31, y: 0.77 };
    const d = regionToOverlay(centre, 0.2, BG, RECT);
    const relu = centerFromOverlayPoint(d.cx, d.cy, RECT);
    expect(relu.x).toBeCloseTo(centre.x, 9);
    expect(relu.y).toBeCloseTo(centre.y, 9);
  });
});

describe("regionHandles — la poignée de rayon reste ATTRAPABLE", () => {
  /* Défaut trouvé au checkpoint sur la vraie fenêtre, et qu'aucun des tests
   * précédents ne pouvait voir : au rayon par DÉFAUT de `pixelStretch` (1,5),
   * le cercle fait deux fois la demi-diagonale de la toile. La poignée, posée
   * sur l'anneau, tombait très largement hors écran — on ne voyait que le point
   * du centre, et il n'existait AUCUN geste pour réduire la zone. Le
   * manipulateur était inutile exactement dans l'état où l'effet arrive. */

  it("au rayon par défaut de pixelStretch, l'anneau sort DÉJÀ de la vue", () => {
    // La prémisse du défaut, mesurée plutôt qu'affirmée. Sans elle, le test
    // suivant vérifierait un rabattement dont rien ne dit qu'il sert.
    const defaut = pixelStretch.params.find((p) => p.name === "regionRadius")?.default ?? 0;
    const d = regionToOverlay({ x: 0.5, y: 0.5 }, defaut, BG, RECT);
    expect(d.cx + d.r).toBeGreaterThan(RECT.left + RECT.width);
  });

  it("la poignée est rabattue dans la vue quand l'anneau en sort", () => {
    const defaut = pixelStretch.params.find((p) => p.name === "regionRadius")?.default ?? 0;
    const d = regionToOverlay({ x: 0.5, y: 0.5 }, defaut, BG, RECT);
    const p = radiusHandlePosition(d, RECT);
    expect(p.x).toBeLessThanOrEqual(RECT.left + RECT.width);
    expect(p.x).toBeGreaterThanOrEqual(RECT.left);
  });

  it("elle NE bouge PAS quand l'anneau tient dans la vue", () => {
    // Le rabattement ne doit pas déplacer un repère qui était déjà juste : la
    // poignée marque le rayon chaque fois qu'elle le peut.
    const d = regionToOverlay({ x: 0.5, y: 0.5 }, 0.05, BG, RECT);
    const p = radiusHandlePosition(d, RECT);
    expect(p.x).toBeCloseTo(d.cx + d.r, 6);
    expect(p.y).toBeCloseTo(d.cy, 6);
  });

  it("le rayon vient de la DISTANCE au pointeur, pas de la position du repère", () => {
    // C'est ce qui rend le rabattement inoffensif : même rabattue, la poignée
    // reste une prise exacte.
    const centre = { x: 0.5, y: 0.5 };
    const d = regionToOverlay(centre, 1.5, BG, RECT);
    const parkee = radiusHandlePosition(d, RECT);
    // On saisit la poignée rabattue et on la tire vers le centre : le rayon
    // obtenu est celui de la NOUVELLE distance, donc bien plus petit que 1,5.
    const reduit = radiusFromOverlayPoint(parkee.x, parkee.y, centre, BG, RECT);
    expect(reduit).toBeLessThan(1.5);
    expect(reduit).toBeGreaterThan(0);
  });
});

describe("regionHandles — les bornes", () => {
  it("le centre peut sortir du cadre, mais pas indéfiniment", () => {
    // Sortir est VOULU : une coulure peut partir d'un centre hors champ, et
    // c'est ce que déclarent les bornes de `regionX`/`regionY`.
    expect(clampRegionCenter({ x: -0.2, y: 1.2 })).toEqual({ x: -0.2, y: 1.2 });
    expect(clampRegionCenter({ x: -9, y: 9 })).toEqual({ x: -0.5, y: 1.5 });
  });

  it("les bornes du centre sont CELLES du paramètre de pixelStretch", () => {
    // Si les deux divergeaient, le manipulateur produirait une valeur que le
    // curseur refuserait ensuite d'afficher — un désaccord silencieux entre
    // deux façons de régler la même chose.
    const x = pixelStretch.params.find((p) => p.name === "regionX");
    expect(x?.min).toBe(-0.5);
    expect(x?.max).toBe(1.5);
  });

  it("le rayon est borné par la plage passée, pas par une constante d'ici", () => {
    expect(clampRegionRadius(99, 0.02, 1.5)).toBe(1.5);
    expect(clampRegionRadius(0, 0.02, 1.5)).toBe(0.02);
    expect(clampRegionRadius(0.4, 0.02, 1.5)).toBe(0.4);
  });
});

describe("pixelStretch — la déclaration du manipulateur", () => {
  it("déclare sa région, et les trois noms existent vraiment", () => {
    // La garde équivalente vit dans `validateEffect` et lève au chargement du
    // registre ; celle-ci nomme l'effet concerné dans un test lisible.
    const region = pixelStretch.canvasRegion;
    expect(region).toEqual({ centerX: "regionX", centerY: "regionY", radius: "regionRadius" });
    const noms = new Set(pixelStretch.params.map((p) => p.name));
    for (const nom of Object.values(region!)) expect(noms.has(nom)).toBe(true);
  });

  it("garde ses curseurs — le cercle vise, ils affinent", () => {
    // Retirer les curseurs au profit du cercle échangerait un défaut
    // d'ergonomie contre un autre : un réglage au pixel près ne se fait pas à
    // la souris.
    for (const nom of ["regionX", "regionY", "regionRadius", "regionFeather"]) {
      expect(pixelStretch.params.some((p) => p.name === nom)).toBe(true);
    }
  });
});
