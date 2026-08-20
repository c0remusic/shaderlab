import { describe, expect, it } from "vitest";
import { getEffect } from "../../../src/render/effects/registry";
import { spatialPixelFactors, parsePixelInput } from "../../../src/render/effects/spatialPixels";
import { isotropicToScreen } from "../../../src/ui/regionHandles";
import { pointToOverlay } from "../../../src/ui/canvasControls";

const landscape = { width: 6000, height: 4000 };
/** Le facteur isotrope du même cadre — sqrt(W·H), la convention du disque. */
const ISO = Math.sqrt(6000 * 4000);

describe("spatialPixelFactors — le facteur fraction → pixels des contrôles spatiaux", () => {
  // Les cinq effets à contrôle spatial, et le facteur attendu de chaque
  // paramètre qui doit se lire en pixels. Les rotations (degrés) et les
  // longueurs d'axe (pixels bruts / convention non réconciliée) sont
  // VOLONTAIREMENT absentes.
  it.each([
    ["aplat", { centreX: 6000, centreY: 4000, largeur: 6000, hauteur: 4000 }],
    ["lensFlare", { sourceX: 6000, sourceY: 4000, sourceRadius: ISO }],
    ["lightLeak", { origineX: 6000, origineY: 4000 }],
    ["motionBlur", { centerX: 6000, centerY: 4000 }],
    ["pixelStretch", { regionX: 6000, regionY: 4000, regionRadius: ISO }],
  ] as const)("%s", (id, attendu) => {
    expect(Object.fromEntries(spatialPixelFactors(getEffect(id), landscape))).toEqual(attendu);
  });

  it("exclut les rotations, déjà en degrés", () => {
    expect(spatialPixelFactors(getEffect("aplat"), landscape).has("rotation")).toBe(false);
    expect(spatialPixelFactors(getEffect("motionBlur"), landscape).has("angle")).toBe(false);
    expect(spatialPixelFactors(getEffect("lightLeak"), landscape).has("direction")).toBe(false);
  });

  it("exclut les longueurs d'axe : amount (none) et portee (convention non réconciliée)", () => {
    // `amount` est déclaré `none` (déjà en pixels côté toile), `portee` est
    // `percent` mais l'overlay le traite en pixels bruts — l'un et l'autre ne
    // se lisent pas en pixels par fraction, donc aucun n'entre.
    expect(spatialPixelFactors(getEffect("motionBlur"), landscape).has("amount")).toBe(false);
    expect(spatialPixelFactors(getEffect("lightLeak"), landscape).has("portee")).toBe(false);
  });

  it("ne rend rien pour un effet sans contrôle spatial", () => {
    expect(spatialPixelFactors(getEffect("glow"), landscape).size).toBe(0);
    expect(spatialPixelFactors(null, landscape).size).toBe(0);
  });

  it("ne rend rien sans cadre réel : `{0,0}` = aucun document ouvert", () => {
    // C'est ce qui fait retomber le panneau sur l'affichage en pourcentage,
    // au lieu d'imprimer « 0 px » partout.
    expect(spatialPixelFactors(getEffect("aplat"), { width: 0, height: 0 }).size).toBe(0);
    expect(spatialPixelFactors(getEffect("aplat"), undefined).size).toBe(0);
  });
});

describe("le facteur du panneau MATCHE la géométrie de la toile", () => {
  // LE FACTEUR DOIT MATCHER LA TOILE, sinon la symétrie ment. Ces deux
  // assertions relient le facteur du panneau à la géométrie du manipulateur.
  const rect = { left: 0, top: 0, width: 6000, height: 4000 }; // 1 px écran = 1 px image

  it("un centre lu en pixels tombe sur la même position que le manipulateur", () => {
    const facteurs = spatialPixelFactors(getEffect("aplat"), landscape);
    const overlay = pointToOverlay({ x: 0.5, y: 0.25 }, rect);
    expect(0.5 * facteurs.get("centreX")!).toBeCloseTo(overlay.x, 6);
    expect(0.25 * facteurs.get("centreY")!).toBeCloseTo(overlay.y, 6);
  });

  it("un rayon lu en pixels vaut ce que le disque du manipulateur mesure", () => {
    // r px écran du disque = r_isotrope × isotropicToScreen ; à échelle 1:1, ce
    // sont des pixels image, et c'est exactement r × le facteur isotrope.
    const facteurs = spatialPixelFactors(getEffect("pixelStretch"), landscape);
    const r = 0.1;
    expect(r * facteurs.get("regionRadius")!).toBeCloseTo(r * isotropicToScreen(landscape, rect), 6);
  });
});

describe("parsePixelInput — la saisie en pixels ramenée en fraction", () => {
  it("divise par le facteur puis cale sur le pas du curseur", () => {
    expect(parsePixelInput("1500", 6000, { min: 0, max: 1, step: 0.001 })).toBe(0.25);
  });

  it("accepte la virgule décimale et le suffixe d'unité que le champ affiche", () => {
    expect(parsePixelInput("1500,5 px", 6000, { min: 0, max: 1, step: 0.001 })).toBe(0.25);
  });

  it("NORMALISE la décimale, comme tous les autres champs de saisie", () => {
    // 1800 / 6000 = 0,3, mais `0 + 3 × 0.1` vaut 0.30000000000000004 en binaire.
    // Sans la normalisation finale, c'est cette poussière qui entrerait dans le
    // document — le seul écart de comportement assumé de ce chemin.
    expect(parsePixelInput("1800", 6000, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
  });

  it("écrête aux bornes du CURSEUR, qui peuvent sortir du cadre", () => {
    expect(parsePixelInput("9000", 6000, { min: 0, max: 1, step: 0.001 })).toBe(1);
    // `sourceX` va de −0,5 à 1,5 : une saisie négative est légitime.
    expect(parsePixelInput("-3000", 6000, { min: -0.5, max: 1.5, step: 0.01 })).toBe(-0.5);
  });

  it("rend null quand la frappe ne porte aucun nombre", () => {
    expect(parsePixelInput("abc", 6000, { min: 0, max: 1, step: 0.001 })).toBeNull();
  });
});
