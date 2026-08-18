import { describe, expect, it } from "vitest";
import { curves, curvesSpec } from "../../../src/render/effects/curves";
import { validateEffect } from "../../../src/render/effects/validate";

const defaults = curves.params.map((param) => param.default);

describe("curves", () => {
  it("déclare 37 paramètres et quatre canaux valides", () => {
    expect(curves.params).toHaveLength(37);
    expect(curves.curveControls?.[0].channels.map((channel) => channel.id)).toEqual(["master", "red", "green", "blue"]);
    expect(() => validateEffect(curves)).not.toThrow();
  });

  it.each([
    [0, 0, 0], [1, 1, 1], [0.18, 0.42, 0.91], [0.8, 0.1, 0.03],
  ] as const)("la droite identité est neutre pour %j", (...rgb) => {
    expect(curvesSpec(rgb, defaults)).toEqual([...rgb]);
  });

  it("reste borné et monotone avec une S-curve maître", () => {
    const params = [...defaults];
    params[1] = 0.25; params[2] = 0.1;
    params[3] = 0.75; params[4] = 0.9;
    let previous = -1;
    for (let index = 0; index <= 256; index += 1) {
      const value = index / 256;
      const result = curvesSpec([value, value, value], params)[0];
      expect(result).toBeGreaterThanOrEqual(previous);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
      previous = result;
    }
  });

  // TRANCHE 2 DU TICKET 12 — la solarisation. Rien n'a été écrit dans l'effet
  // pour elle : ce test EXISTE pour prouver que le rendu la portait déjà, et
  // que la contrainte était côté interface seule (`constrainCurvePoint`).
  it("porte une courbe qui DESCEND puis remonte, sans déborder", () => {
    const params = [...defaults];
    params[1] = 0.35; params[2] = 0.9;
    params[3] = 0.65; params[4] = 0.1;
    const gris = (v: number) => curvesSpec([v, v, v], params)[0];
    for (let index = 0; index <= 256; index += 1) {
      const sortie = gris(index / 256);
      expect(sortie).toBeGreaterThanOrEqual(0);
      expect(sortie).toBeLessThanOrEqual(1);
    }
    // La descente est REELLE, pas un palier : c'est la seule assertion que la
    // contrainte d'origine faisait échouer.
    expect(gris(0.65)).toBeLessThan(gris(0.35));
    expect(gris(1)).toBeGreaterThan(gris(0.65));
  });

  it("une courbe rouge ne déplace pas les canaux vert et bleu", () => {
    const params = [...defaults];
    params[8] = 0.2;
    const result = curvesSpec([0.1, 0.4, 0.7], params);
    expect(result[0]).toBeCloseTo(0.28, 12);
    expect(result[1]).toBeCloseTo(0.4, 12);
    expect(result[2]).toBeCloseTo(0.7, 12);
  });
});
