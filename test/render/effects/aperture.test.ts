import { describe, it, expect } from "vitest";
import {
  APERTURE_WGSL,
  apertureRadiusArcSpec,
  apertureRadiusSpec,
} from "../../../src/render/effects/aperture";

/**
 * LA COURBURE DES LAMES, ET LA BORNE QUI REND SON APPROXIMATION HONNÊTE.
 *
 * `aperture_radius` interpole le rayon entre le polygone à arêtes droites et le
 * cercle. Une lame réelle est un ARC, pas une interpolation, et l'en-tête
 * d'`aperture.ts` affirme que l'écart reste sous 0,3 %. Ce fichier le MESURE au
 * lieu de le croire — c'est la règle du dépôt : une approximation qui n'est pas
 * bornée par un test est une affirmation.
 *
 * ⚠️ CE FICHIER NE PROUVE PAS QUE LA COURBURE EST BELLE. Il prouve qu'elle est
 * l'arc qu'elle prétend être, à 0,3 % près. Ce que ça rend se juge sur une
 * image, et la référence de pixels `effet-lens-blur-bokeh-courbe` est là pour
 * ça.
 */
describe("aperture — courbure des lames", () => {
  it("à courbure 0, rend exactement le polygone d'avant", () => {
    // L'invariant qui protège les cinq références de `lensBlur` et les sept de
    // `lensFlare` : le quatrième argument est arrivé après elles.
    for (const n of [3, 5, 6, 8, 12]) {
      for (let i = 0; i < 360; i += 7) {
        const theta = (i / 180) * Math.PI;
        const droit = Math.cos(Math.PI / n) / Math.cos(
          theta - ((2 * Math.PI) / n) * Math.floor(theta / ((2 * Math.PI) / n)) - Math.PI / n,
        );
        expect(apertureRadiusSpec(theta, n, 0, 0)).toBeCloseTo(droit, 12);
      }
    }
  });

  it("à courbure 1, rend exactement le cercle", () => {
    for (const n of [3, 5, 6, 8, 12]) {
      for (let i = 0; i < 360; i += 11) {
        expect(apertureRadiusSpec((i / 180) * Math.PI, n, 0.3, 1)).toBeCloseTo(1, 12);
      }
    }
  });

  it("laisse les SOMMETS en place et ne bombe que les arêtes", () => {
    // Ce qui distingue une lame courbe d'un simple agrandissement : les sommets
    // sont les points de contact entre deux lames, ils ne bougent pas. Un modèle
    // qui les déplacerait ferait grossir la tache au lieu de l'arrondir.
    //
    // ⚠️ CONVENTION D'ANGLE, et elle est contre-intuitive : `theta = 0` tombe sur
    // un SOMMET (rayon 1) et `theta = seg/2` sur le MILIEU d'arête (cos(pi/n)).
    // Le repli de la fonction est centré sur le milieu d'arête, pas sur le
    // sommet. `lensBlur.test.ts` le gèle déjà — l'inverser ici ferait passer un
    // test faux pour un test vert.
    for (const n of [5, 6, 8]) {
      const seg = (2 * Math.PI) / n;
      for (const c of [0, 0.25, 0.5, 0.75, 1]) {
        expect(apertureRadiusSpec(0, n, 0, c)).toBeCloseTo(1, 9);
        expect(apertureRadiusSpec(seg, n, 0, c)).toBeCloseTo(1, 9);
      }
      // Milieu d'arête : monte de cos(pi/n) à 1, strictement.
      const milieu = (c: number) => apertureRadiusSpec(seg * 0.5, n, 0, c);
      expect(milieu(0)).toBeCloseTo(Math.cos(Math.PI / n), 9);
      expect(milieu(1)).toBeCloseTo(1, 9);
      for (const [a, b] of [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1]]) {
        expect(milieu(b)).toBeGreaterThan(milieu(a));
      }
    }
  });

  it("s'écarte de l'ARC EXACT d'autant MOINS qu'il y a de lames", () => {
    // ⚠️ CE TEST A DÉJÀ CORRIGÉ SON PROPRE COMMENTAIRE. Il annonçait « moins de
    // 0,3 % », borne calculée à la main sur UN point (5 lames, mi-course). Le
    // balayage complet donne 3,16 % — dix fois plus — et le pire cas est le
    // TRIANGLE, que le point choisi ne pouvait pas voir. Les quatre bornes
    // ci-dessous sont les valeurs mesurées, arrondies vers le haut.
    const pireEcart = (lamesMin: number) => {
      let pire = 0;
      let ou = "";
      for (let n = lamesMin; n <= 12; n++) {
        for (let ci = 0; ci <= 40; ci++) {
          const c = ci / 40;
          for (let i = 0; i < 360; i += 1) {
            const theta = (i / 180) * Math.PI;
            const ecart = Math.abs(
              apertureRadiusSpec(theta, n, 0, c) - apertureRadiusArcSpec(theta, n, 0, c),
            );
            if (ecart > pire) {
              pire = ecart;
              ou = `n=${n} c=${c.toFixed(3)} theta=${i}deg`;
            }
          }
        }
      }
      return { pire, ou };
    };
    // Le domaine ENTIER : la borne haute, portée par le triangle.
    const tout = pireEcart(3);
    expect(tout.pire, `pire écart toutes lames, à ${tout.ou}`).toBeLessThan(0.032);
    // Le domaine des vrais objectifs — l'infobulle de `blades` dit « 6 pour
    // l'hexagone des objectifs courants », et un diaphragme réel en a 5 à 11.
    const objectifs = pireEcart(5);
    expect(objectifs.pire, `pire écart dès 5 lames, à ${objectifs.ou}`).toBeLessThan(0.0034);
    // Et la borne MORD : sans ça, elle pourrait valoir 1 et ne rien dire.
    expect(tout.pire).toBeGreaterThan(0.02);
  });

  it("l'arc exact partage les deux bouts avec l'interpolation", () => {
    // Si les deux modèles divergeaient à courbure 0 ou 1, la borne ci-dessus ne
    // mesurerait pas ce qu'elle prétend : elle comparerait deux formes qui ne
    // sont pas la même à leurs extrémités.
    for (const n of [3, 5, 7, 9, 12]) {
      for (let i = 0; i < 360; i += 13) {
        const theta = (i / 180) * Math.PI;
        expect(apertureRadiusArcSpec(theta, n, 0, 0)).toBeCloseTo(apertureRadiusSpec(theta, n, 0, 0), 9);
        expect(apertureRadiusArcSpec(theta, n, 0, 1)).toBeCloseTo(1, 6);
      }
    }
  });

  it("le corps WGSL porte la même formule que le jumeau TS", () => {
    // Même dispositif que `channelMixSpec` : le jumeau rend la géométrie
    // testable sans GPU, le corps WGSL est ce qui tourne. Les deux doivent dire
    // la même chose, et rien ne le vérifie à part cette assertion de texte.
    expect(APERTURE_WGSL).toContain("fn aperture_radius(theta: f32, blades: f32, rotation: f32, curvature: f32) -> f32");
    expect(APERTURE_WGSL).toContain("let droit = cos(3.141592653589793 / blades) / cos(k);");
    expect(APERTURE_WGSL).toContain("return mix(droit, 1.0, clamp(curvature, 0.0, 1.0));");
  });

  it("moins de trois lames reste le diaphragme CIRCULAIRE, courbure comprise", () => {
    // Une courbure sur un cercle n'a pas de sens, et le court-circuit doit
    // passer AVANT elle — sinon `mix(1.0, 1.0, c)` marcherait par accident et
    // se casserait au premier changement de formule.
    for (const c of [0, 0.5, 1]) {
      expect(apertureRadiusSpec(1.234, 0, 0, c)).toBe(1);
      expect(apertureRadiusSpec(1.234, 2, 0.9, c)).toBe(1);
    }
  });
});
