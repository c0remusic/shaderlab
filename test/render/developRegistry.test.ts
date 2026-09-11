import { describe, expect, it } from "vitest";
import {
  developApplyOrder,
  developDisplayOrder,
  developModules,
  getDevelopModule,
  isDevelopModuleAtDefault,
} from "../../src/render/developRegistry";
import { etalonnage } from "../../src/render/effects/etalonnage";
import { effectRegistry, getEffect } from "../../src/render/effects/registry";

/**
 * L'ÉTAGE DE DÉVELOPPEMENT — sa liste et son ordre sont GELÉS ici, exactement
 * comme `lensDistortion.test` gèle la famille des halos (ticket 03). Élargir
 * l'étage doit faire rougir un test, sinon la frontière entre « effet
 * choisissable » et « module de l'étage » dérive toute seule.
 */
describe("registre de l'étage de développement", () => {
  it("l'ordre d'APPLICATION est celui déclaré (Lightroom : Étalonnage en premier)", () => {
    // TRANCHE 1 : seul `etalonnage`. Les modules suivants (Réglages de base, HSL,
    // Color Grading, Détail, Vignettage) prennent leur place à SA place dans
    // cette liste — l'inverser ou l'élargir sans mettre à jour ce test rougit.
    expect(developApplyOrder.map((m) => m.id)).toEqual(["etalonnage"]);
  });

  it("l'ordre d'AFFICHAGE est celui déclaré", () => {
    expect(developDisplayOrder.map((m) => m.id)).toEqual(["etalonnage"]);
  });

  it("`etalonnage` est dans l'étage et PAS dans le registre des effets", () => {
    expect(developModules).toContain(etalonnage);
    expect(effectRegistry.some((e) => e.id === "etalonnage")).toBe(false);
  });

  it("`getEffect` résout un module de l'étage par id, comme `passthrough`", () => {
    expect(getEffect("etalonnage")).toBe(etalonnage);
    expect(getDevelopModule("etalonnage")).toBe(etalonnage);
  });

  it("`getDevelopModule` rend `undefined` pour un id inconnu", () => {
    expect(getDevelopModule("nexistepas")).toBeUndefined();
    // Un vrai effet de calque n'est PAS un module de l'étage.
    expect(getDevelopModule("glow")).toBeUndefined();
  });
});

describe("un module au défaut est sauté (gate discriminant)", () => {
  it("valeurs absentes -> au défaut", () => {
    expect(isDevelopModuleAtDefault(etalonnage, undefined)).toBe(true);
  });

  it("toutes valeurs égales aux défauts -> au défaut", () => {
    const defauts: Record<string, number> = {};
    for (const p of etalonnage.params) defauts[p.name] = p.default;
    expect(isDevelopModuleAtDefault(etalonnage, defauts)).toBe(true);
    // Un sous-ensemble aux défauts (les autres retombent sur leur défaut) aussi.
    expect(isDevelopModuleAtDefault(etalonnage, { blueHue: etalonnage.params.find((p) => p.name === "blueHue")!.default })).toBe(true);
  });

  it("une seule valeur hors défaut -> PAS au défaut", () => {
    expect(isDevelopModuleAtDefault(etalonnage, { blueHue: -60 })).toBe(false);
  });
});
