import { describe, expect, it } from "vitest";
import { resolveEffectAnchor } from "../../../src/render/effects/spatialParams";
import type { CanvasControl, EffectModule, EffectParam } from "../../../src/render/effects/types";

/**
 * L'ANCRE DE L'ÉTIREMENT (ticket 24, voie B) — le point FIXE de la déformation
 * `uvT = (uv - ancre) * inv + ancre`. C'est la position de l'effet quand il en a
 * une, le centre de toile sinon. Même résolution que `ui/effectMove.ts` : valeur
 * du calque sinon défaut, `visibleWhen` respecté.
 */

function position(name: string, defaut: number): EffectParam {
  return { name, label: name, unit: "percent", min: -0.5, max: 1.5, default: defaut, step: 0.01 };
}
function scalaire(name: string, defaut: number, min: number, max: number): EffectParam {
  return { name, label: name, unit: "none", min, max, default: defaut, step: 0.01 };
}

const POINT: CanvasControl = { id: "p", kind: "point", x: "px", y: "py", label: "Point" };
const AXE: CanvasControl = { id: "a", kind: "axis", angle: "aa", length: "al", label: "Axe" };

function moduleAvec(controls: CanvasControl[] | undefined, params: EffectParam[]): Pick<EffectModule, "canvasControls" | "params"> {
  return { canvasControls: controls, params };
}

describe("resolveEffectAnchor", () => {
  it("centre de toile pour un effet SANS ancrage", () => {
    const effect = moduleAvec(undefined, [scalaire("k", 0.3, 0, 1)]);
    expect(resolveEffectAnchor(effect, {})).toEqual({ x: 0.5, y: 0.5 });
  });

  it("centre de toile quand le seul contrôle est un AXE (ni x ni y)", () => {
    const effect = moduleAvec([AXE], [scalaire("aa", 30, 0, 360), scalaire("al", 100, 0, 2000)]);
    expect(resolveEffectAnchor(effect, {})).toEqual({ x: 0.5, y: 0.5 });
  });

  it("prend la position du calque sur les rôles x/y", () => {
    const effect = moduleAvec([POINT], [position("px", 0.5), position("py", 0.5)]);
    expect(resolveEffectAnchor(effect, { px: 0.9, py: 0.2 })).toEqual({ x: 0.9, y: 0.2 });
  });

  it("retombe sur le DÉFAUT du paramètre quand le calque ne l'écrit pas", () => {
    const effect = moduleAvec([POINT], [position("px", 1), position("py", 0.32)]);
    expect(resolveEffectAnchor(effect, {})).toEqual({ x: 1, y: 0.32 });
  });

  it("SAUTE un contrôle dont le visibleWhen n'est pas rempli", () => {
    // Deux points : le premier masqué (mode 1 requis, on est en mode 0), le
    // second visible. L'ancre doit venir du second, jamais du point invisible.
    const masque: CanvasControl = { id: "m", kind: "point", x: "mx", y: "my", label: "Masqué", visibleWhen: { param: "mode", equals: [1] } };
    const visible: CanvasControl = { id: "v", kind: "point", x: "vx", y: "vy", label: "Visible", visibleWhen: { param: "mode", equals: [0] } };
    const effect = moduleAvec([masque, visible], [
      scalaire("mode", 0, 0, 1),
      position("mx", 0.1), position("my", 0.1),
      position("vx", 0.8), position("vy", 0.7),
    ]);
    expect(resolveEffectAnchor(effect, { mode: 0 })).toEqual({ x: 0.8, y: 0.7 });
  });
});
