import { describe, it, expect } from "vitest";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";
import { glow } from "../../../src/render/effects/glow";
import { PASSTHROUGH_EFFECT } from "../../../src/render/effectPassRunner";

describe("effectRegistry", () => {
  it("contains the glow effect", () => {
    expect(effectRegistry).toContainEqual(glow);
  });

  it("getEffect resolves a known id", () => {
    expect(getEffect("glow")).toBe(glow);
  });

  it("getEffect throws on an unknown id", () => {
    expect(() => getEffect("nonexistent")).toThrow(/Effet inconnu/);
  });

  it("getEffect resolves \"passthrough\" to PASSTHROUGH_EFFECT without adding it to effectRegistry", () => {
    expect(getEffect("passthrough")).toBe(PASSTHROUGH_EFFECT);
    expect(effectRegistry.some((e) => e.id === "passthrough")).toBe(false);
  });

  it("exposes French display metadata for chromatic bleed parameters", () => {
    const chromaticBleed = getEffect("chromaticBleed");

    expect(chromaticBleed.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "amount",
          label: "Décalage chromatique",
          unit: "percent",
        }),
        expect.objectContaining({
          name: "centerFalloff",
          label: "Atténuation centrale",
          unit: "none",
        }),
      ]),
    );
  });
});

describe("glow effect module", () => {
  it("defines threshold and intensity params with sane defaults", () => {
    const threshold = glow.params.find((p) => p.name === "threshold");
    const intensity = glow.params.find((p) => p.name === "intensity");
    expect(threshold).toMatchObject({ min: 0, max: 1, default: 0.55, step: 0.01 });
    // Plafond d'intensité monté de 3 à 6 et défaut de 1.0 à 1.6 : le halo
    // plafonnait bien avant que le curseur ne bute, faute de course.
    expect(intensity).toMatchObject({ min: 0, max: 6, default: 1.6, step: 0.05 });
  });

  it("declares an fs_main entry point in its WGSL", () => {
    expect(glow.wgsl).toMatch(/fn fs_main\(/);
  });
});

describe("la famille des flous — ce qui en reste, et ce qui n'y entre pas", () => {
  // CE BLOC A DEMENAGE DEPUIS `surfaceBlur.test.ts` le 2026-08-03, et le geste
  // vaut d'etre explique : le garde d'ADR-0010 vivait dans le fichier de test
  // de `surfaceBlur`. Retirer l'effet aurait donc supprime la DECISION avec
  // lui, en silence et sans qu'aucun test ne rougisse — une decision active
  // n'a rien a faire dans le fichier d'un effet qui peut disparaitre.
  it("n'introduit PAS de gaussien au registre (ADR-0010)", () => {
    // La reference du §6ter dit qu'un gaussien lave l'image : il efface les
    // contours en meme temps que ce qu'on voulait attenuer. Un flou doux reste
    // atteignable par `lensBlur` a bokeh nul.
    expect(effectRegistry.some((e) => e.id === "gaussianBlur")).toBe(false);
    expect(effectRegistry.some((e) => e.id === "boxBlur")).toBe(false);
    expect(effectRegistry.some((e) => e.id === "averageBlur")).toBe(false);
  });

  it("ne contient plus surfaceBlur, retire sur verdict d'usage (ADR-0011)", () => {
    // Le bilateral est sorti du registre le 2026-08-03. Ce test n'est pas une
    // tautologie : il rend le retrait CONSCIENT. Le reintroduire demande de
    // supprimer cette ligne, donc de relire l'ADR qui l'a decide.
    expect(effectRegistry.some((e) => e.id === "surfaceBlur")).toBe(false);
    expect(() => getEffect("surfaceBlur")).toThrow();
  });

  it("garde les deux flous qui restent, et eux seuls", () => {
    const flous = effectRegistry.filter((e) => /blur/i.test(e.id)).map((e) => e.id);
    expect(flous.sort()).toEqual(["lensBlur", "motionBlur"]);
  });
});
