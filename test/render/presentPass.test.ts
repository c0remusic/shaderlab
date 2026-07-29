import { describe, expect, it } from "vitest";
import {
  buildPresentWgsl,
  presentBackgroundFor,
  CHECKER_CELL_PX,
} from "../../src/render/presentPass";

// Tranche T0 (design 2026-07-28 « le fond devient un calque »). Ce qui est
// verrouillé ici est la SÉPARATION écran/export, pas le rendu : le damier est
// un rendu d'écran, il ne doit jamais atteindre un fichier exporté.
describe("presentBackgroundFor", () => {
  it("le canvas reçoit le damier", () => {
    expect(presentBackgroundFor({ kind: "canvas" })).toBe("checker");
  });

  it("l'export reçoit du noir opaque, JAMAIS le damier", () => {
    expect(presentBackgroundFor({ kind: "export" })).toBe("black");
  });

  it("aucune destination ne peut demander autre chose que ces deux fonds", () => {
    // Le fond n'est pas un paramètre d'appel : il est dérivé de la destination,
    // et `PresentDestination` est un type fermé à deux cas. C'est ce qui rend
    // « le damier dans le JPEG » inexprimable, pas une convention d'appel.
    const backgrounds = (["canvas", "export"] as const).map((kind) =>
      presentBackgroundFor({ kind }),
    );
    expect(new Set(backgrounds)).toEqual(new Set(["checker", "black"]));
  });
});

describe("buildPresentWgsl", () => {
  it("sort toujours un alpha de 1 — la surface finale est opaque par construction", () => {
    for (const bg of ["checker", "black"] as const) {
      expect(buildPresentWgsl(bg)).toContain(
        "return vec4<f32>(src.rgb * src.a + bg * (1.0 - src.a), 1.0);",
      );
    }
  });

  it("le fond d'export est du noir pur (donc identité quand src.a = 1)", () => {
    const code = buildPresentWgsl("black");
    expect(code).toContain("let bg = vec3<f32>(0.0);");
    // Aucune trace de damier dans la source destinée au fichier.
    expect(code).not.toContain("fract");
    expect(code).not.toContain("in.position");
  });

  it("le damier est posé en pixels de la DESTINATION, pas en UV d'image", () => {
    const code = buildPresentWgsl("checker");
    expect(code).toContain(`let cell = floor(in.position.xy / ${CHECKER_CELL_PX}.0);`);
    expect(code).toContain("let odd = step(0.5, fract((cell.x + cell.y) * 0.5));");
  });

  it("les gris du damier sont décodés depuis sRGB (cible -srgb, sortie linéaire)", () => {
    const code = buildPresentWgsl("checker");
    expect(code).toContain("srgb2lin(mix(vec3<f32>(1.0), vec3<f32>(0.8), odd))");
    expect(code).toContain("fn srgb2lin");
  });

  it("embarque le vertex plein écran et un point d'entrée fragment unique", () => {
    const code = buildPresentWgsl("black");
    expect(code).toContain("fn vs_main");
    expect(code).toContain("fn fs_present");
  });

  it("produit deux sources distinctes (deux pipelines, pas un uniforme)", () => {
    expect(buildPresentWgsl("checker")).not.toBe(buildPresentWgsl("black"));
  });
});
