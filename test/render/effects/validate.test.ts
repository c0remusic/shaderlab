import { describe, it, expect } from "vitest";
import { validateEffect } from "../../../src/render/effects/validate";
import { effectRegistry } from "../../../src/render/effects/registry";
import { MAX_EFFECT_PARAMS } from "../../../src/render/shaderCompose";
import type { EffectModule } from "../../../src/render/effects/types";

function effectWithParams(count: number): EffectModule {
  return {
    id: "test-effect",
    name: "Test",
    params: Array.from({ length: count }, (_, i) => ({
      name: `p${i}`,
      min: 0,
      max: 1,
      default: 0,
      step: 0.1,
    })),
    wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }",
  };
}

describe("validateEffect", () => {
  // Bornes dérivées de la constante et non recopiées : le plafond a déjà été
  // relevé deux fois (8 -> 11 pour le duotone, 11 -> 16 pour les paramètres
  // étendus), et chaque fois ces deux tests tombaient au rouge sans qu'aucune
  // régression ne les motive.
  it("accepts an effect at exactly the param limit", () => {
    expect(() => validateEffect(effectWithParams(MAX_EFFECT_PARAMS))).not.toThrow();
  });

  it("rejects an effect over the limit with the effect id in the message", () => {
    const over = MAX_EFFECT_PARAMS + 1;
    expect(() => validateEffect(effectWithParams(over))).toThrow(
      new RegExp(`test-effect.*${over}.*${MAX_EFFECT_PARAMS}`),
    );
  });

  it("every registered effect is valid", () => {
    for (const effect of effectRegistry) {
      expect(() => validateEffect(effect)).not.toThrow();
    }
  });

  // MAXIMUM DYNAMIQUE (`EffectParam.maxFrom`, 2026-08-03). Il ne peut que
  // RESSERRER la course : `max` reste la borne que le panneau, les presets et
  // toute relecture prennent pour la vérité du paramètre. Un `maxFrom` au-dessus
  // rendrait un curseur allant plus loin que ce que l'effet déclare — l'inverse
  // exact du défaut qu'il vient corriger (voir `sliceShift.edgeFeather`).
  function effectWithMaxFrom(maxFrom: (p: Record<string, number>) => number): EffectModule {
    const base = effectWithParams(2);
    base.params[1] = { ...base.params[1], name: "borne", max: 10, default: 4, maxFrom };
    return base;
  }

  it("accepts a maxFrom that narrows the range", () => {
    expect(() => validateEffect(effectWithMaxFrom((p) => p.p0 + 4))).not.toThrow();
  });

  it("rejects a maxFrom that widens past the declared max", () => {
    expect(() => validateEffect(effectWithMaxFrom(() => 99))).toThrow(
      /borne.*maxFrom.*99.*0\.\.10/s,
    );
  });

  it("rejects a maxFrom that returns something not finite", () => {
    // Une division par un paramètre à zéro est le cas réaliste, et elle rendrait
    // un curseur sans borne haute plutôt qu'une erreur.
    expect(() => validateEffect(effectWithMaxFrom(() => Number.POSITIVE_INFINITY))).toThrow(
      /maxFrom/,
    );
  });

  it("rejects a canvas control whose parameter is absent", () => {
    const effect = effectWithParams(2);
    effect.params[0] = { ...effect.params[0], unit: "percent" };
    effect.params[1] = { ...effect.params[1], unit: "percent" };
    effect.canvasControls = [{ id: "source", kind: "point", x: "p0", y: "missing", label: "Source" }];
    expect(() => validateEffect(effect)).toThrow(/paramètre absent "missing"/);
  });

  it("rejects duplicate canvas control ids", () => {
    const effect = effectWithParams(2);
    effect.params = effect.params.map((p) => ({ ...p, unit: "percent" }));
    effect.canvasControls = [
      { id: "source", kind: "point", x: "p0", y: "p1", label: "Source" },
      { id: "source", kind: "point", x: "p0", y: "p1", label: "Source" },
    ];
    expect(() => validateEffect(effect)).toThrow(/dupliqué "source"/);
  });

  it("rejects incompatible point units", () => {
    const effect = effectWithParams(2);
    effect.canvasControls = [{ id: "source", kind: "point", x: "p0", y: "p1", label: "Source" }];
    expect(() => validateEffect(effect)).toThrow(/doivent être en percent/);
  });

  it("allows point visibility to depend on a choices parameter", () => {
    const effect = effectWithParams(3);
    effect.params = [
      { ...effect.params[0], choices: ["A", "B"], min: 0, max: 1, step: 1, default: 0 },
      { ...effect.params[1], unit: "percent" },
      { ...effect.params[2], unit: "percent" },
    ];
    effect.canvasControls = [{ id: "center", kind: "point", x: "p1", y: "p2", label: "Centre", visibleWhen: { param: "p0", equals: 1 } }];
    expect(() => validateEffect(effect)).not.toThrow();
  });

  it("rejects a canvas visibility condition outside the available choices", () => {
    const effect = effectWithParams(3);
    effect.params = [
      { ...effect.params[0], choices: ["A", "B"], min: 0, max: 1, step: 1, default: 0 },
      { ...effect.params[1], unit: "percent" },
      { ...effect.params[2], unit: "percent" },
    ];
    effect.canvasControls = [{ id: "center", kind: "point", x: "p1", y: "p2", label: "Centre", visibleWhen: { param: "p0", equals: 2 } }];
    expect(() => validateEffect(effect)).toThrow(/index de choix invalide 2/);
  });

  function effectWithCurve(): EffectModule {
    const effect = effectWithParams(12);
    effect.params = effect.params.map((param) => ({ ...param, min: 0, max: 1 }));
    effect.params[0].default = 0;
    effect.params[1] = { ...effect.params[1], min: -1, default: 0.25 };
    effect.params[2].default = 0.25;
    effect.params[3] = { ...effect.params[3], min: -1, default: -1 };
    effect.params[4].default = 0.5;
    effect.params[5] = { ...effect.params[5], min: -1, default: -1 };
    effect.params[6].default = 0.75;
    effect.params[7].default = 1;
    effect.curveControls = [{
      id: "curves", label: "Courbes", channels: [{ id: "master", label: "Maître", startY: "p0",
        points: [{ x: "p1", y: "p2" }, { x: "p3", y: "p4" }, { x: "p5", y: "p6" }], endY: "p7" }],
    }];
    return effect;
  }

  it("accepts an ordered bounded curve declaration", () => {
    expect(() => validateEffect(effectWithCurve())).not.toThrow();
  });

  it("rejects an active curve slot after an inactive slot", () => {
    const effect = effectWithCurve();
    effect.params.find((param) => param.name === "p5")!.default = 0.75;
    expect(() => validateEffect(effect)).toThrow(/slot de courbe actif suit un slot inactif/);
  });

  it("rejects a curve parameter that is absent", () => {
    const effect = effectWithCurve();
    effect.curveControls![0].channels[0].endY = "missing";
    expect(() => validateEffect(effect)).toThrow(/courbe désigne le paramètre absent "missing"/);
  });

  it("validates tonal range parameter existence and default order", () => {
    const effect = effectWithParams(4);
    effect.params.forEach((param, index) => { param.default = index * 0.25; });
    effect.tonalRangeControl = { shadowsMin: "p0", shadowsMax: "p1", highlightsMin: "p2", highlightsMax: "p3" };
    expect(() => validateEffect(effect)).not.toThrow();
    effect.params[2].default = 0.1;
    expect(() => validateEffect(effect)).toThrow(/bornes tonales par défaut non ordonnées/);
  });

  it("validates a three-stop color ramp declaration", () => {
    const effect = effectWithParams(12);
    effect.params[10].default = 0;
    effect.params[11].default = 1;
    effect.colorRampControls = [{ id: "ramp", label: "Rampe", blackPoint: "p10", whitePoint: "p11", stops: [
      { id: "shadow", label: "Sombre", hue: "p0", saturation: "p1", lightness: "p2" },
      { id: "mid", label: "Moyen", hue: "p3", saturation: "p4", lightness: "p5", position: "p9" },
      { id: "high", label: "Clair", hue: "p6", saturation: "p7", lightness: "p8" },
    ] }];
    expect(() => validateEffect(effect)).not.toThrow();
    effect.colorRampControls[0].stops[2].hue = "missing";
    expect(() => validateEffect(effect)).toThrow(/rampe désigne le paramètre absent "missing"/);
  });

  it("validates three independently positioned color stops", () => {
    const effect = effectWithParams(14);
    effect.params[9].default = 0;
    effect.params[10].default = 0.5;
    effect.params[11].default = 1;
    effect.params[12].default = 0;
    effect.params[13].default = 1;
    effect.colorRampControls = [{ id: "ramp", label: "Rampe", blackPoint: "p12", whitePoint: "p13", stops: [
      { id: "shadow", label: "Sombre", hue: "p0", saturation: "p1", lightness: "p2", position: "p9" },
      { id: "mid", label: "Moyen", hue: "p3", saturation: "p4", lightness: "p5", position: "p10" },
      { id: "high", label: "Clair", hue: "p6", saturation: "p7", lightness: "p8", position: "p11" },
    ] }];
    expect(() => validateEffect(effect)).not.toThrow();
    effect.params[11].default = 0.4;
    expect(() => validateEffect(effect)).toThrow(/arrêts couleur de rampe non ordonnés/);
  });

});
