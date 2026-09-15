import { describe, expect, it } from "vitest";
import { effectRegistry } from "../../../src/render/effects/registry";
import { developModules } from "../../../src/render/developRegistry";
import { validateEffect } from "../../../src/render/effects/validate";
import { blendRegistry } from "../../../src/render/blend/registry";
import type { EffectModule } from "../../../src/render/effects/types";

/**
 * Le contrat d'un effet est déclaré à TROIS endroits qui ne se parlent pas : le
 * type (`types.ts`, 28 champs), les règles de données (`validate.ts`, 47
 * vérifications), et la PROSE — une dizaine de règles qu'aucun lecteur
 * automatique ne lit.
 *
 * C'est la troisième pile qui coûte le plus cher, parce qu'elle est la seule
 * sans garde. Quatre de ses règles sont désormais vérifiées dans
 * `validateEffect`, donc au chargement du registre, donc en CI. Celles qui
 * restent ici sont celles que `validateEffect` NE PEUT PAS voir sans faire
 * dépendre `effects/` d'un autre paquet — un test, lui, voit les deux.
 */

const tousLesModules: EffectModule[] = [...effectRegistry, ...developModules];

describe("contrat d'un effet — ce que `validateEffect` ne peut pas voir seul", () => {
  it("inspecte bien le registre — garde de SIGNAL", () => {
    expect(effectRegistry.length).toBeGreaterThanOrEqual(25);
    expect(developModules.length).toBeGreaterThanOrEqual(3);
  });

  it("`defaultBlendMode` désigne un mode de fusion RÉEL", () => {
    // `types.ts` le dit en prose et ajoute que `validateEffect` « ne peut pas le
    // vérifier sans faire dépendre `effects/` de `blend/` ». C'est juste — et ce
    // test n'a pas cette contrainte. Sans lui, une faute de frappe ne se voit
    // qu'au moment où l'utilisateur pose l'effet : `getBlendMode` lève alors, en
    // plein geste.
    const ids = new Set(blendRegistry.map((m) => m.id));
    const fautifs = tousLesModules
      .filter((e) => e.defaultBlendMode !== undefined && !ids.has(e.defaultBlendMode))
      .map((e) => `${e.id} → "${e.defaultBlendMode}"`);
    expect(fautifs).toEqual([]);
  });

  it("`defaultOpacity` reste dans 0..1", () => {
    const fautifs = tousLesModules
      .filter((e) => e.defaultOpacity !== undefined && !(e.defaultOpacity >= 0 && e.defaultOpacity <= 1))
      .map((e) => `${e.id} → ${e.defaultOpacity}`);
    expect(fautifs).toEqual([]);
  });

  it("tout le registre passe `validateEffect` — y compris ses quatre règles neuves", () => {
    // Le registre le fait déjà à son chargement ; le refaire ici nomme l'effet
    // fautif dans le rapport de test au lieu d'un échec d'import opaque.
    for (const module of tousLesModules) {
      expect(() => validateEffect(module), `effet "${module.id}"`).not.toThrow();
    }
  });
});

describe("les règles rapatriées de la prose SAVENT rougir", () => {
  // Témoins de discrimination. Une garde qu'on n'a jamais vue échouer rend un
  // vert sans valeur — et trois de ces quatre règles n'existaient que sous forme
  // de phrase dans un JSDoc.
  const base = (patch: Partial<EffectModule>): EffectModule => ({
    id: "essai",
    name: "Essai",
    params: [],
    wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }",
    ...patch,
  });

  it("refuse un corps WGSL sans `fs_main`", () => {
    expect(() => validateEffect(base({ wgsl: "fn autre() -> f32 { return 1.0; }" }))).toThrow(/fs_main/);
  });

  it("refuse un effet à texture dont le shader ne teste jamais `textureDimensions`", () => {
    expect(() =>
      validateEffect(
        base({
          params: [{ name: "rang", label: "Rang", min: 0, max: 9, default: 0, step: 1 }],
          libraryTexture: { indexParam: "rang" },
        }),
      ),
    ).toThrow(/textureDimensions/);
  });

  it("accepte le même effet dès que son shader teste le repli 1×1", () => {
    expect(() =>
      validateEffect(
        base({
          params: [{ name: "rang", label: "Rang", min: 0, max: 9, default: 0, step: 1 }],
          libraryTexture: { indexParam: "rang" },
          wgsl:
            "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { " +
            "let d = textureDimensions(libraryTexture); if (d.x <= 1u) { return color; } return color; }",
        }),
      ),
    ).not.toThrow();
  });

  it("refuse un groupe de couleur amputé d'un rôle", () => {
    // `ParamPanel` levait déjà — mais à l'exécution, quand l'utilisateur ouvre le
    // panneau de cet effet. Une déclaration incomplète passait tous les gates.
    expect(() =>
      validateEffect(
        base({
          params: [
            { name: "t", label: "T", min: 0, max: 360, default: 0, step: 1, colorGroup: { key: "encre", role: "hue", label: "Encre" } },
            { name: "s", label: "S", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "encre", role: "saturation", label: "Encre" } },
          ],
        }),
      ),
    ).toThrow(/lightness/);
  });

  it("refuse un rôle déclaré DEUX fois dans le même groupe", () => {
    expect(() =>
      validateEffect(
        base({
          params: [
            { name: "a", label: "A", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "encre", role: "hue", label: "Encre" } },
            { name: "b", label: "B", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "encre", role: "hue", label: "Encre" } },
          ],
        }),
      ),
    ).toThrow(/deux fois/);
  });
});
