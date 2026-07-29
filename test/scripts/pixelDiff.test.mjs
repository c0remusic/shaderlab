import { describe, it, expect } from "vitest";
import { comparePixels, verdictFor, ROUNDING_LSB, ROUNDING_MAX_RATIO } from "../../scripts/lib/pixelDiff.mjs";

/** La classification d'un ecart decide si une modification de rendu est vue ou
 *  non. C'est la seule partie du harnais qui n'a pas besoin d'un GPU pour etre
 *  verifiee — donc la seule qu'on puisse verrouiller ici. */
describe("comparePixels", () => {
  it("ne trouve rien entre deux tampons egaux", () => {
    const a = new Uint8Array([1, 2, 3, 255]);
    expect(comparePixels(a, new Uint8Array(a))).toMatchObject({ differing: 0, maxAbs: 0, firstIndex: -1 });
  });

  it("compte les CANAUX divergents, pas les pixels, et retient le premier", () => {
    const a = new Uint8Array([0, 0, 0, 255, 10, 10, 10, 255]);
    const b = new Uint8Array([0, 0, 0, 255, 12, 10, 13, 255]);
    const s = comparePixels(a, b);
    expect(s.differing).toBe(2);
    expect(s.maxAbs).toBe(3);
    expect(s.firstIndex).toBe(4);
    expect(s.ratio).toBeCloseTo(2 / 8);
  });

  it("leve plutot que de comparer deux tailles differentes", () => {
    expect(() => comparePixels(new Uint8Array(4), new Uint8Array(8))).toThrow(/longueurs/);
  });
});

describe("verdictFor", () => {
  const stats = (differing, maxAbs, channels) => ({ channels, differing, maxAbs, ratio: differing / channels, meanAbs: 0, firstIndex: 0 });

  it("identique quand rien ne bouge", () => {
    expect(verdictFor(stats(0, 0, 1000)).verdict).toBe("identique");
  });

  it("rendu-modifie des qu'un canal depasse le LSB, meme seul", () => {
    expect(verdictFor(stats(1, ROUNDING_LSB + 1, 1_000_000)).verdict).toBe("rendu-modifie");
  });

  it("infra-lsb-epars quand l'ecart est d'1 LSB ET disperse", () => {
    const n = 1_000_000;
    const v = verdictFor(stats(Math.floor(n * ROUNDING_MAX_RATIO * 0.5), ROUNDING_LSB, n));
    expect(v.verdict).toBe("infra-lsb-epars");
    // La formulation compte autant que le verdict : cette classe n'est PAS une
    // absolution (le temoin du harnais tombe dedans).
    expect(v.raison).toMatch(/pas une preuve/);
  });

  it("rendu-modifie quand l'ecart d'1 LSB couvre une SURFACE", () => {
    const n = 1_000_000;
    expect(verdictFor(stats(Math.ceil(n * ROUNDING_MAX_RATIO) + 1, ROUNDING_LSB, n)).verdict).toBe("rendu-modifie");
  });
});
