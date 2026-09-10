import { describe, it, expect } from "vitest";
import { etalonnage, etalonnageSpec } from "../../../src/render/effects/etalonnage";

/**
 * `etalonnageSpec` est le jumeau TS du shader (même patron que `channelMixSpec`
 * et `aperture`) : ces tests portent sur l'ALGÈBRE, pas sur le WGSL. Que le
 * shader calcule bien la même chose est vérrouillé ailleurs, par les références
 * de rendu (`effet-etalonnage-temoin/-bleu/-nuance`).
 *
 * Les propriétés que l'effet PROMET et qui doivent tenir à tout réglage : le
 * témoin est l'identité, un gris reste un gris, le blanc reste blanc. Puis deux
 * mesures qui bornent le mécanisme et sont NOTÉES parce qu'elles ne valent qu'à
 * un chiffre près — le couplage résiduel d'une primaire sur une autre par la
 * renormalisation, et la symétrie de la rotation.
 */

/** Défauts déclarés, dans l'ordre du uniform — la vraie entrée du shader. */
const defauts = (): number[] => etalonnage.params.map((p) => p.default);

const idx = (nom: string): number => {
  const i = etalonnage.params.findIndex((p) => p.name === nom);
  if (i < 0) throw new Error(`paramètre "${nom}" absent d'etalonnage`);
  return i;
};

const avec = (modifs: Record<string, number>): number[] => {
  const p = defauts();
  for (const [nom, v] of Object.entries(modifs)) p[idx(nom)] = v;
  return p;
};

type Vec3 = [number, number, number];
const dist = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("etalonnage — jumeau de la matrice de primaires", () => {
  it("réglages à 0 : identité au bit près", () => {
    for (const c of [[0.2, 0.5, 0.8], [0, 0, 0], [1, 1, 1], [0.37, 0.02, 0.91]] as Vec3[]) {
      expect(etalonnageSpec(c, defauts())).toEqual(c);
    }
  });

  it("un gris reste un gris exact, à tout réglage de primaire", () => {
    const reglages = [
      avec({ blueHue: -60, blueSaturation: 40 }),
      avec({ redHue: 80, redSaturation: -30 }),
      avec({ greenHue: -100, greenSaturation: 100 }),
      avec({ redHue: 40, greenHue: -70, blueHue: 55, blueSaturation: 60 }),
    ];
    for (const p of reglages) {
      for (const g of [0.1, 0.3, 0.5, 0.75, 0.95]) {
        const out = etalonnageSpec([g, g, g], p);
        // shadowTint est à 0 dans tous ces réglages : la nuance ne teinte que les
        // ombres, elle ne fait pas partie de l'invariance des gris de la matrice.
        expect(dist(out, [g, g, g])).toBeLessThan(1e-4);
      }
    }
  });

  it("le blanc reste blanc", () => {
    for (const p of [avec({ blueHue: -60, blueSaturation: 40 }), avec({ redHue: 100, redSaturation: 100 })]) {
      expect(dist(etalonnageSpec([1, 1, 1], p), [1, 1, 1])).toBeLessThan(1e-4);
    }
  });

  it("tourner le bleu ne touche QUE PEU un rouge pur (couplage par renormalisation)", () => {
    // La renormalisation au blanc divise chaque ligne par la somme des trois
    // colonnes ; tourner le bleu change cette somme, donc la colonne rouge s'en
    // trouve LÉGÈREMENT modifiée après normalisation. C'est inhérent au choix de
    // normalisation par ligne (documenté dans l'en-tête de l'effet). Mesuré ici :
    // le déplacement d'un rouge pur reste petit, très en dessous de ce que la
    // rotation du rouge lui-même produit.
    const rougePur: Vec3 = [1, 0, 0];
    const parLeBleu = dist(etalonnageSpec(rougePur, avec({ blueHue: -60, blueSaturation: 40 })), rougePur);
    const parLeRouge = dist(etalonnageSpec(rougePur, avec({ redHue: -60, redSaturation: 40 })), rougePur);
    // NOTÉ : mesuré EXACTEMENT 0 ici. Un rouge pur passe par la seule colonne
    // rouge, qui reste ≈(1,0,0) ; la rotation du bleu ne change que la somme de la
    // ligne rouge (le diviseur), ce qui pousse la sortie à ~1,09 — et le clamp de
    // sortie la ramène à 1, donc un rouge pur reste un rouge pur. La primaire
    // ROUGE, elle, le déplace franchement (0,071).
    expect(parLeBleu).toBeLessThan(0.02);
    expect(parLeRouge).toBeGreaterThan(0.03);
  });

  it("la rotation de teinte est BIPOLAIRE : les deux signes agissent, distinctement", () => {
    // La « symétrie ± » ne peut PAS être une antisymétrie géométrique exacte : une
    // teinte tourne sur un CERCLE (pas une réflexion), et le clamp de gamut casse
    // l'égalité d'amplitude sur les primaires pures. Ce qui doit tenir, et qui est
    // la vraie garde contre un curseur à moitié mort, c'est la bipolarité : +h et
    // −h écartent tous deux la couleur de son identité, et vers des points
    // DIFFÉRENTS. NOTÉ : un test d'antisymétrie stricte (cos ≈ −1) échoue à dessein,
    // le mécanisme n'a pas cette propriété.
    const teal: Vec3 = [0.1, 0.55, 0.6];
    const base = etalonnageSpec(teal, defauts());
    const plus = etalonnageSpec(teal, avec({ blueHue: 70 }));
    const moins = etalonnageSpec(teal, avec({ blueHue: -70 }));
    expect(dist(plus, base)).toBeGreaterThan(1e-3);
    expect(dist(moins, base)).toBeGreaterThan(1e-3);
    expect(dist(plus, moins)).toBeGreaterThan(1e-3);
  });

  it("la nuance foncée teinte les ombres et épargne les hautes lumières", () => {
    const ombre: Vec3 = [0.05, 0.05, 0.05];
    const clair: Vec3 = [0.95, 0.95, 0.95];
    const magenta = avec({ shadowTint: 80 });
    const vert = avec({ shadowTint: -80 });
    const ombreMagenta = etalonnageSpec(ombre, magenta);
    // Magenta = +R −V +B : le vert descend, rouge et bleu montent.
    expect(ombreMagenta[1]).toBeLessThan(ombre[1]);
    expect(ombreMagenta[0]).toBeGreaterThan(ombre[0]);
    // Vert = l'inverse.
    expect(etalonnageSpec(ombre, vert)[1]).toBeGreaterThan(ombre[1]);
    // Les hautes lumières sont quasi épargnées ((1 − luma)² ≈ 0).
    expect(dist(etalonnageSpec(clair, magenta), clair)).toBeLessThan(0.005);
  });
});
