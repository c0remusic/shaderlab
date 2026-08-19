import { describe, it, expect } from "vitest";
import { planRefine, octagonRadii, type RefinePass } from "../../src/mask/refinePlan";
import { defaultRefineEdge, type RefineEdgeParams } from "../../src/mask/types";

/** Ce fichier ferme un trou laissé ouvert par morphologySeparable.test.ts :
 *  celui-là prouve l'équivalence des passes 1D avec leur élément structurant,
 *  mais ne regarde jamais combien de passes sont réellement planifiées.
 *  Réduire la morphologie à un sous-ensemble d'axes le laissait entièrement
 *  vert, pour un masque érodé sur une partie des axes — faux, et silencieux.
 *
 *  Depuis le 2026-08-19 l'élément est un OCTOGONE (carré H/V ⊕ losange
 *  D1/D2) : quatre passes au rayon courant, deux aux rayons dégénérés
 *  (r=1 : carré seul ; r=2 : losange seul). Les assertions verrouillent le
 *  compte de passes, les axes, ET le contrat géométrique d'octagonRadii —
 *  extension axiale EXACTE, écart diagonal borné, balayés sur toute la
 *  course du curseur (mesurer un seul point a déjà produit une borne fausse,
 *  voir effects/aperture.ts). */

const params = (over: Partial<RefineEdgeParams> = {}): RefineEdgeParams => ({
  ...defaultRefineEdge(),
  ...over,
});

const morph = (plan: RefinePass[]) => plan.filter((p) => p.kind === "morphology");

describe("planRefine — morphologie octogonale : les passes suivent octagonRadii", () => {
  it("contract=±1 : carré seul (2 passes H/V rayon 1 — la quantification ne laisse pas mieux)", () => {
    for (const contract of [-1, 1]) {
      const plan = morph(planRefine(params({ contract })));
      expect(plan.map((p) => p.axis)).toEqual(["H", "V"]);
      expect(plan.every((p) => p.radius === 1)).toBe(true);
    }
  });

  it("contract=±2 : losange seul (2 passes D1/D2 rayon 1)", () => {
    for (const contract of [-2, 2]) {
      const plan = morph(planRefine(params({ contract })));
      expect(plan.map((p) => p.axis)).toEqual(["D1", "D2"]);
      expect(plan.every((p) => p.radius === 1)).toBe(true);
    }
  });

  for (const contract of [-50, -7, 7, 50]) {
    it(`contract=${contract} : 4 passes, axes H·V·D1·D2 dans cet ordre`, () => {
      const plan = morph(planRefine(params({ contract })));
      expect(plan.map((p) => p.axis)).toEqual(["H", "V", "D1", "D2"]);
      const { axial, diagonal } = octagonRadii(Math.abs(contract));
      expect(plan[0].radius).toBe(axial);
      expect(plan[1].radius).toBe(axial);
      expect(plan[2].radius).toBe(diagonal);
      expect(plan[3].radius).toBe(diagonal);
    });
  }

  it("contract NÉGATIF -> erode partout, POSITIF -> dilate partout", () => {
    expect(morph(planRefine(params({ contract: -8 }))).every((p) => p.mode === "erode")).toBe(true);
    expect(morph(planRefine(params({ contract: 8 }))).every((p) => p.mode === "dilate")).toBe(true);
  });
});

describe("octagonRadii — le contrat géométrique, balayé sur toute la course", () => {
  it("extension AXIALE exacte : axial + 2·diagonal === r, et aucun rayon négatif (r=1..50)", () => {
    for (let r = 1; r <= 50; r++) {
      const { axial, diagonal } = octagonRadii(r);
      expect(axial + 2 * diagonal).toBe(r);
      expect(axial).toBeGreaterThanOrEqual(0);
      expect(diagonal).toBeGreaterThanOrEqual(0);
    }
  });

  it("extension DIAGONALE euclidienne ((axial+diagonal)·√2) dans ±14 % du rayon dès r=3", () => {
    // L'ancien carré débordait de +41 % à 45°, à TOUT rayon. Le pire du
    // balayage est r=5 (+13,1 %) : à ce rayon, k=1 donne +13,1 % et k=2
    // donne −15,2 % — aucune décomposition entière ne fait mieux, c'est la
    // quantification. Dès r=7, l'écart tient dans ±6,1 %.
    for (let r = 3; r <= 50; r++) {
      const { axial, diagonal } = octagonRadii(r);
      const diag = (axial + diagonal) * Math.SQRT2;
      expect(Math.abs(diag / r - 1), `r=${r} diag=${diag.toFixed(2)}`).toBeLessThanOrEqual(0.14);
    }
  });

  it("dès r=7, l'écart diagonal tient dans ±6,1 %", () => {
    for (let r = 7; r <= 50; r++) {
      const { axial, diagonal } = octagonRadii(r);
      const diag = (axial + diagonal) * Math.SQRT2;
      expect(Math.abs(diag / r - 1), `r=${r}`).toBeLessThanOrEqual(0.061);
    }
  });
});

describe("planRefine — rayon 0", () => {
  // Comportement CONSTATÉ dans l'encodeur avant l'extraction
  // (maskTextureResolver.ts, `if (x.contract)`) : contract === 0 n'encodait
  // AUCUNE passe de morphologie. Conservé tel quel — un rayon 0 est
  // l'identité (morphologySeparable.test.ts « rayon 0 »), donc encoder deux
  // fullscreen pour ne rien changer serait un coût pur.
  it("contract=0 : ZÉRO passe de morphologie (pas deux passes identité)", () => {
    expect(morph(planRefine(params({ contract: 0 })))).toHaveLength(0);
  });

  it("contract=0 n'empêche pas les autres passes de figurer au plan", () => {
    const plan = planRefine(params({ contract: 0, feather: 4 }));
    expect(morph(plan)).toHaveLength(0);
    expect(plan).toEqual([{ kind: "featherSat", radius: 4 }]);
  });

  it("tout à zéro (défaut) : plan VIDE — l'appelant rend l'entrée telle quelle", () => {
    expect(planRefine(defaultRefineEdge())).toEqual([]);
  });
});

describe("planRefine — feather et smooth", () => {
  // Le feather encodait DEUX passes de box filter, dont le cout etait
  // proportionnel au rayon. Depuis le 2026-08-13 il en encode UNE, un lookup
  // sur table de sommes cumulees, dont le cout n'en depend plus : mesure en
  // production sur 26 Mpx, 164 images par seconde a petit rayon contre 48 a
  // rayon 50. Le plan ne dit rien de la CONSTRUCTION de la table — elle est a
  // la charge de l'encodeur, qui la met en cache.
  it("feather > 0 : une seule passe, au rayon du feather", () => {
    expect(planRefine(params({ feather: 6 }))).toEqual([{ kind: "featherSat", radius: 6 }]);
  });

  it("feather <= 0 : aucune passe (un rayon négatif n'a pas de sens ici)", () => {
    expect(planRefine(params({ feather: 0 }))).toEqual([]);
    expect(planRefine(params({ feather: -3 }))).toEqual([]);
  });

  for (const smooth of [1, 2, 10]) {
    it(`smooth=${smooth} : ${smooth} itérations de 2 passes rayon 1`, () => {
      const plan = planRefine(params({ smooth }));
      expect(plan).toHaveLength(smooth * 2);
      expect(plan.every((p) => p.kind === "boxFilter" && p.radius === 1)).toBe(true);
    });
  }

  it("ordre global : morphologie, puis feather, puis smooth", () => {
    const plan = planRefine(params({ contract: -2, feather: 5, smooth: 1 }));
    expect(plan).toEqual([
      { kind: "morphology", mode: "erode", axis: "D1", radius: 1 },
      { kind: "morphology", mode: "erode", axis: "D2", radius: 1 },
      { kind: "featherSat", radius: 5 },
      { kind: "boxFilter", axis: "H", radius: 1 },
      { kind: "boxFilter", axis: "V", radius: 1 },
    ]);
  });

  it("plan vide SEULEMENT si les trois réglages sont neutres", () => {
    expect(planRefine(params({ contract: 1 })).length).toBeGreaterThan(0);
    expect(planRefine(params({ feather: 1 })).length).toBeGreaterThan(0);
    expect(planRefine(params({ smooth: 1 })).length).toBeGreaterThan(0);
    expect(planRefine(params())).toEqual([]);
  });

  it("edgeAware/edgeRadius/edgeStrength ne pèsent PAS sur ce plan (autre étage)", () => {
    expect(
      planRefine(params({ edgeAware: true, edgeRadius: 30, edgeStrength: 0.5 })),
    ).toEqual([]);
  });
});
