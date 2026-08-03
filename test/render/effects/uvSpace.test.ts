import { describe, it, expect } from "vitest";
import {
  aspectScale,
  isotropicUvOffset,
  mirrorCoord,
  UV_SPACE_WGSL,
} from "../../../src/render/effects/uvSpace";
import { lensDistortion } from "../../../src/render/effects/lensDistortion";
import { warp } from "../../../src/render/effects/warp";

/** Déplacement PIXEL produit par un décalage exprimé en UV. */
function pixelDisplacement(
  uvOffset: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: uvOffset.x * width, y: uvOffset.y * height };
}

describe("aspectScale", () => {
  it("vaut exactement (1,1) sur une image carrée (aucun changement de rendu)", () => {
    expect(aspectScale(2048, 2048)).toEqual({ x: 1, y: 1 });
  });

  it("rejette une dimension nulle ou négative (fail-fast)", () => {
    expect(() => aspectScale(0, 100)).toThrow(/dimensions invalides/);
    expect(() => aspectScale(100, -1)).toThrow(/dimensions invalides/);
  });

  it("conserve l'ordre de grandeur global (produit des composantes = 1)", () => {
    const ar = aspectScale(6000, 4000);
    expect(ar.x * ar.y).toBeCloseTo(1, 12);
    expect(ar.x).toBeGreaterThan(1);
    expect(ar.y).toBeLessThan(1);
  });
});

describe("isotropie du décalage sur une image NON CARRÉE", () => {
  const W = 6000;
  const H = 4000; // 3:2

  it("un décalage nominal corrigé produit le MÊME déplacement en pixels en X et en Y", () => {
    const nominal = { x: 0.01, y: 0.01 };
    const d = pixelDisplacement(isotropicUvOffset(nominal, W, H), W, H);
    expect(d.x).toBeCloseTo(d.y, 9);
  });

  it("verrouille le bug corrigé : sans correction, X se déplace 1.5x plus que Y en 3:2", () => {
    const naive = { x: 0.01, y: 0.01 };
    const d = pixelDisplacement(naive, W, H);
    expect(d.x / d.y).toBeCloseTo(W / H, 12);
    expect(d.x / d.y).toBeCloseTo(1.5, 12);
  });

  it("l'isotropie tient pour toute direction et tout ratio", () => {
    for (const [w, h] of [[6000, 4000], [4000, 6000], [8000, 1000], [3000, 3000]]) {
      for (const nominal of [{ x: 0.02, y: 0 }, { x: 0, y: 0.02 }, { x: 0.013, y: -0.007 }]) {
        const d = pixelDisplacement(isotropicUvOffset(nominal, w, h), w, h);
        // Même vecteur nominal -> même vecteur pixel, à un facteur d'échelle
        // commun aux deux axes (la moyenne géométrique des dimensions).
        const ref = Math.sqrt(w * h);
        expect(d.x).toBeCloseTo(nominal.x * ref, 9);
        expect(d.y).toBeCloseTo(nominal.y * ref, 9);
      }
    }
  });

  it("le rendu d'une image carrée est inchangé (décalage UV identique au nominal)", () => {
    const nominal = { x: 0.01, y: -0.004 };
    expect(isotropicUvOffset(nominal, 2048, 2048)).toEqual(nominal);
  });
});

describe("mirrorCoord (repli de bord)", () => {
  it("laisse [0,1] intact", () => {
    for (const v of [0, 0.25, 0.5, 0.999, 1]) {
      expect(mirrorCoord(v)).toBeCloseTo(v, 12);
    }
  });

  it("replie par réflexion au lieu de répéter le bord", () => {
    expect(mirrorCoord(1.05)).toBeCloseTo(0.95, 12);
    expect(mirrorCoord(-0.05)).toBeCloseTo(0.05, 12);
    expect(mirrorCoord(1.3)).toBeCloseTo(0.7, 12);
  });

  it("reste dans [0,1] même loin hors cadre", () => {
    for (const v of [-3.7, -1.2, 2.4, 5.9]) {
      const m = mirrorCoord(v);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });

  it("est continu au bord (pas de saut) — contrairement au clamp qui étire", () => {
    expect(Math.abs(mirrorCoord(1.001) - mirrorCoord(0.999))).toBeLessThan(0.003);
  });
});

describe("intégration WGSL", () => {
  it("UV_SPACE_WGSL définit les deux helpers", () => {
    expect(UV_SPACE_WGSL).toContain("fn aspectScale(dims: vec2<f32>) -> vec2<f32>");
    expect(UV_SPACE_WGSL).toContain("dims / sqrt(dims.x * dims.y)");
    expect(UV_SPACE_WGSL).toContain("fn mirrorUv(uv: vec2<f32>) -> vec2<f32>");
  });

  it("lensDistortion corrige l'aspect et replie ses taps hors cadre", () => {
    // CE TEST PORTAIT SUR `chromaticBleed` jusqu'au 2026-08-03, et il a été
    // reporté ici plutôt que supprimé avec lui (ADR-0016) : la propriété est
    // celle de l'aberration chromatique en général, pas d'un fichier.
    expect(lensDistortion.wgsl).toContain("fn aspectScale(");
    expect(lensDistortion.wgsl).toContain("aspectScale(dims)");
    // Taps R et B décalés SÉPARÉMENT — une vraie lentille ne décale pas les
    // deux canaux de façon strictement opposée (c'est `asymmetry`).
    expect(lensDistortion.wgsl).toContain("courseR = aberration * (1.0 + asymmetry)");
    expect(lensDistortion.wgsl).toContain("courseB = aberration * (1.0 - asymmetry)");
    // Repli hors cadre : le décalage est maximal AU BORD, donc les taps R/B
    // sortent du cadre là où l'effet est le plus visible. `lensUv` le porte pour
    // tout le monde, y compris la branche d'orientation qui l'appelle à la main.
    expect(lensDistortion.wgsl).toContain("return mirrorUv(p * facteur / ar + vec2<f32>(0.5));");
    // La ROTATION du décalage se fait dans l'espace corrigé de l'aspect, avant
    // la reconversion en UV — la faire après serait un cisaillement déguisé sur
    // toute image non carrée. C'est l'avertissement que l'effet absorbé portait.
    expect(lensDistortion.wgsl).toContain("(base + vec2<f32>(dR.x * ca - dR.y * sa, dR.x * sa + dR.y * ca)) / ar");
    // le canal vert n'est pas décalé par l'aberration : c'est la référence.
    expect(lensDistortion.wgsl).toContain("var uvG = lensUv(p, ar, geom);");
  });

  it("warp corrige l'aspect et replie son tap hors cadre", () => {
    expect(warp.wgsl).toContain("aspectScale(vec2<f32>(textureDimensions(srcTexture)))");
    expect(warp.wgsl).toContain("* amplitude / ar");
    expect(warp.wgsl).toContain("mirrorUv(uv + offset)");
  });
});
