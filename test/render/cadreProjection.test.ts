import { describe, expect, it } from "vitest";
import {
  regionDeLecture,
  remapUvPourCadre,
  IDENTITY_UV_REMAP,
} from "../../src/render/cadreProjection";

/**
 * PROJECTION DU CADRE — les deux fonctions pures du câblage du recadrage
 * (ticket 32, tranche A). Elles sont la frontière testable sans GPU : la
 * région de relecture de l'export et le remappage UV de la présentation.
 */

describe("regionDeLecture", () => {
  it("cadre null = la toile entière (comportement d'avant le câblage)", () => {
    expect(regionDeLecture(null, 256, 256)).toEqual({ x: 0, y: 0, width: 256, height: 256 });
  });

  it("cadre = quart central : le sous-rectangle exact", () => {
    expect(regionDeLecture({ x: 64, y: 64, width: 128, height: 128 }, 256, 256)).toEqual({
      x: 64,
      y: 64,
      width: 128,
      height: 128,
    });
  });

  it("cadre asymétrique non carré : chaque axe indépendant", () => {
    expect(regionDeLecture({ x: 10, y: 40, width: 200, height: 60 }, 320, 200)).toEqual({
      x: 10,
      y: 40,
      width: 200,
      height: 60,
    });
  });

  it("écrête un cadre qui déborde à droite/en bas (plancher défensif)", () => {
    // Largeur demandée 300 depuis x=200 sur une toile de 256 : il ne reste que 56.
    expect(regionDeLecture({ x: 200, y: 200, width: 300, height: 300 }, 256, 256)).toEqual({
      x: 200,
      y: 200,
      width: 56,
      height: 56,
    });
  });

  it("arrondit à l'entier un cadre fractionnaire", () => {
    expect(regionDeLecture({ x: 10.6, y: 10.2, width: 100.4, height: 99.6 }, 256, 256)).toEqual({
      x: 11,
      y: 10,
      width: 100,
      height: 100,
    });
  });
});

describe("remapUvPourCadre", () => {
  it("cadre null = identité (rendu inchangé au bit près)", () => {
    expect(remapUvPourCadre(null, 256, 256)).toBe(IDENTITY_UV_REMAP);
  });

  it("quart central : offset 0.25, échelle 0.5", () => {
    expect(remapUvPourCadre({ x: 64, y: 64, width: 128, height: 128 }, 256, 256)).toEqual({
      offset: [0.25, 0.25],
      scale: [0.5, 0.5],
    });
  });

  it("cadre au coin haut-gauche : offset nul, échelle partielle", () => {
    expect(remapUvPourCadre({ x: 0, y: 0, width: 64, height: 32 }, 256, 128)).toEqual({
      offset: [0, 0],
      scale: [0.25, 0.25],
    });
  });

  it("cadre non carré sur une toile non carrée : offset et échelle par axe", () => {
    expect(remapUvPourCadre({ x: 80, y: 48, width: 160, height: 96 }, 320, 192)).toEqual({
      offset: [0.25, 0.25],
      scale: [0.5, 0.5],
    });
  });
});
