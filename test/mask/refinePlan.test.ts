import { describe, it, expect } from "vitest";
import { planRefine, type RefinePass } from "../../src/mask/refinePlan";
import { MORPHOLOGY_PASS_AXES } from "../../src/mask/refineEdgeWgsl";
import { defaultRefineEdge, type RefineEdgeParams } from "../../src/mask/types";

/** Ce fichier ferme un trou laissé ouvert par morphologySeparable.test.ts :
 *  celui-là prouve que DEUX passes 1D équivalent à la fenêtre carrée, mais ne
 *  regarde jamais combien de passes sont réellement planifiées. Réduire la
 *  morphologie à UN seul axe le laissait entièrement vert, pour un masque
 *  érodé sur un seul axe — faux, et silencieux.
 *
 *  Les assertions ci-dessous sont donc écrites pour ROUGIR sur ce scénario
 *  précis : nombre de passes de morphologie, axes distincts, ordre. */

const params = (over: Partial<RefineEdgeParams> = {}): RefineEdgeParams => ({
  ...defaultRefineEdge(),
  ...over,
});

const morph = (plan: RefinePass[]) => plan.filter((p) => p.kind === "morphology");

describe("planRefine — morphologie : DEUX passes 1D, jamais une seule", () => {
  for (const contract of [-50, -7, -1, 1, 7, 50]) {
    it(`contract=${contract} : exactement 2 passes de morphologie`, () => {
      expect(morph(planRefine(params({ contract })))).toHaveLength(2);
    });

    it(`contract=${contract} : un axe H et un axe V, DISTINCTS`, () => {
      const axes = morph(planRefine(params({ contract }))).map((p) => p.axis);
      expect(new Set(axes).size).toBe(2);
      expect(axes).toEqual([...MORPHOLOGY_PASS_AXES]);
    });
  }

  it("le plan couvre les deux axes déclarés, sans en oublier ni en inventer", () => {
    const axes = morph(planRefine(params({ contract: 12 }))).map((p) => p.axis);
    expect([...axes].sort()).toEqual([...MORPHOLOGY_PASS_AXES].sort());
    expect(axes).toHaveLength(MORPHOLOGY_PASS_AXES.length);
  });

  it("contract NÉGATIF -> erode, rayon positif (le signe est consommé par le mode)", () => {
    const plan = morph(planRefine(params({ contract: -8 })));
    expect(plan.every((p) => p.mode === "erode")).toBe(true);
    expect(plan.every((p) => p.radius === 8)).toBe(true);
  });

  it("contract POSITIF -> dilate, même rayon sur les deux axes", () => {
    const plan = morph(planRefine(params({ contract: 8 })));
    expect(plan.every((p) => p.mode === "dilate")).toBe(true);
    expect(plan.every((p) => p.radius === 8)).toBe(true);
  });

  it("les deux passes portent le MÊME mode et le MÊME rayon", () => {
    const [a, b] = morph(planRefine(params({ contract: -3 })));
    expect(a.mode).toBe(b.mode);
    expect(a.radius).toBe(b.radius);
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
      { kind: "morphology", mode: "erode", axis: "H", radius: 2 },
      { kind: "morphology", mode: "erode", axis: "V", radius: 2 },
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
