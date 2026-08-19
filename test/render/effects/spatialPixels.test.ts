import { describe, expect, it } from "vitest";
import { getEffect } from "../../../src/render/effects/registry";
import { spatialPixelAxes, pixelFactorForAxis } from "../../../src/render/effects/spatialPixels";
import { isotropicToScreen } from "../../../src/ui/regionHandles";
import { pointToOverlay } from "../../../src/ui/canvasControls";

const landscape = { width: 6000, height: 4000 };

describe("spatialPixelAxes — les axes pixel des contrôles spatiaux", () => {
  // Les cinq effets à contrôle spatial, et l'axe attendu de chaque paramètre
  // qui doit se lire en pixels. Les rotations (degrés) et les longueurs d'axe
  // (pixels bruts / convention non réconciliée) sont VOLONTAIREMENT absentes.
  it.each([
    ["aplat", { centreX: "x", centreY: "y", largeur: "x", hauteur: "y" }],
    ["lensFlare", { sourceX: "x", sourceY: "y", sourceRadius: "iso" }],
    ["lightLeak", { origineX: "x", origineY: "y" }],
    ["motionBlur", { centerX: "x", centerY: "y" }],
    ["pixelStretch", { regionX: "x", regionY: "y", regionRadius: "iso" }],
  ] as const)("%s", (id, attendu) => {
    const axes = spatialPixelAxes(getEffect(id));
    expect(Object.fromEntries(axes)).toEqual(attendu);
  });

  it("exclut les rotations, déjà en degrés", () => {
    expect(spatialPixelAxes(getEffect("aplat")).has("rotation")).toBe(false);
    expect(spatialPixelAxes(getEffect("motionBlur")).has("angle")).toBe(false);
    expect(spatialPixelAxes(getEffect("lightLeak")).has("direction")).toBe(false);
  });

  it("exclut les longueurs d'axe : amount (none) et portee (convention non réconciliée)", () => {
    // `amount` est déclaré `none` (déjà en pixels côté toile), `portee` est
    // `percent` mais l'overlay le traite en pixels bruts — l'un et l'autre ne
    // se lisent pas en pixels par fraction, donc aucun n'entre.
    expect(spatialPixelAxes(getEffect("motionBlur")).has("amount")).toBe(false);
    expect(spatialPixelAxes(getEffect("lightLeak")).has("portee")).toBe(false);
  });

  it("ne rend rien pour un effet sans contrôle spatial", () => {
    expect(spatialPixelAxes(getEffect("glow")).size).toBe(0);
    expect(spatialPixelAxes(null).size).toBe(0);
  });
});

describe("pixelFactorForAxis — le facteur fraction → pixels", () => {
  it("lit la largeur, la hauteur, ou l'échelle isotrope", () => {
    expect(pixelFactorForAxis("x", landscape)).toBe(6000);
    expect(pixelFactorForAxis("y", landscape)).toBe(4000);
    expect(pixelFactorForAxis("iso", landscape)).toBeCloseTo(Math.sqrt(6000 * 4000), 6);
  });

  // LE FACTEUR DOIT MATCHER LA TOILE, sinon la symétrie ment. Ces deux
  // assertions relient le facteur du panneau à la géométrie du manipulateur.
  it("un centre lu en pixels tombe sur la même position que le manipulateur", () => {
    const rect = { left: 0, top: 0, width: 6000, height: 4000 }; // 1 px écran = 1 px image
    const overlay = pointToOverlay({ x: 0.5, y: 0.25 }, rect);
    expect(0.5 * pixelFactorForAxis("x", landscape)).toBeCloseTo(overlay.x, 6);
    expect(0.25 * pixelFactorForAxis("y", landscape)).toBeCloseTo(overlay.y, 6);
  });

  it("un rayon lu en pixels vaut ce que le disque du manipulateur mesure", () => {
    const rect = { left: 0, top: 0, width: 6000, height: 4000 }; // 1 px écran = 1 px image
    // r px écran du disque = r_isotrope × isotropicToScreen ; à échelle 1:1, ce
    // sont des pixels image, et c'est exactement r × pixelFactorForAxis("iso").
    const r = 0.1;
    expect(r * pixelFactorForAxis("iso", landscape)).toBeCloseTo(r * isotropicToScreen(landscape, rect), 6);
  });
});
