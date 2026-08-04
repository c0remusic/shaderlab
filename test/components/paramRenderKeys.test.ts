import { describe, it, expect } from "vitest";
import { groupEffectParams } from "../../src/components/ParamPanel";
import { effectRegistry } from "../../src/render/effects/registry";

/**
 * GARDE DE CLÉS DE RENDU — née d'un bug trouvé sur pièce le 2026-08-02.
 *
 * Antoine : « on a aussi un bug de "couleur des gouttes" qui reste persistant
 * même après avoir changé d'effet après avoir utilisé gooey merge ».
 *
 * Cause : `gooeyMerge` déclare un paramètre nommé `tint` (le curseur
 * « Colorisation ») ET un `colorGroup` de clé `"tint"`. `ParamPanel` donnait
 * `key={item.param.name}` aux paramètres simples et `key={item.key}` aux
 * groupes — donc DEUX enfants de la même liste avec la clé `"tint"`. Une clé
 * dupliquée casse la réconciliation de liste de React : au démontage, le bloc
 * de couleur restait dans le DOM. Mesuré en direct par CDP, sur une page
 * fraîche : passer de Gooey merge à Glow (qui ne déclare AUCUN groupe de
 * couleur) laissait « Couleur des gouttes » affiché, un fantôme de plus à
 * chaque passage, et il ne répondait plus au clic puisque React ne le possédait
 * plus.
 *
 * Pourquoi une GARDE et pas seulement le correctif : rien n'empêchait — ni le
 * compilateur, ni ESLint, ni un test — de nommer un paramètre comme un groupe.
 * React lui-même n'avertit que sur les clés MANQUANTES, pas sur les doublons,
 * en production. Le défaut était donc structurellement invisible, exactement
 * comme le paramètre non câblé qu'attrape `parametresCables.test.ts` : deux
 * DÉCLARATIONS qui se contredisent, sans signature observable ailleurs.
 */

describe("clés de rendu du panneau de paramètres", () => {
  for (const effect of effectRegistry) {
    it(`${effect.id} : deux items de rendu ne partagent jamais une clé React`, () => {
      const contrôlés = new Set(effect.curveControls?.flatMap((control) => control.channels.flatMap((channel) => [channel.startY, channel.endY, ...channel.points.flatMap((point) => [point.x, point.y])])) ?? []);
      if (effect.tonalRangeControl) Object.values(effect.tonalRangeControl).forEach((name) => contrôlés.add(name));
      const cles = groupEffectParams(effect.params, effect.canvasControls, contrôlés).map((item) => item.reactKey);
      const doublons = cles.filter((c, i) => cles.indexOf(c) !== i);
      expect(doublons, `clés dupliquées dans ${effect.id} : ${doublons.join(", ")}`).toEqual([]);
      expect(new Set(cles).size).toBe(cles.length);
      for (const name of contrôlés) expect(cles).not.toContain(`param:${name}`);
    });
  }

  it("gooeyMerge EST le cas qui a payé cette garde, et il tient", () => {
    // On vérifie que la collision historique existe TOUJOURS au niveau des
    // déclarations — c'est elle que le préfixe neutralise. Si un jour le
    // paramètre était renommé, ce test le dirait au lieu de laisser croire que
    // la garde est encore éprouvée par un cas réel.
    const gooey = effectRegistry.find((e) => e.id === "gooeyMerge");
    expect(gooey, "gooeyMerge doit être au registre").toBeDefined();

    const nomsDeParams = gooey!.params.map((p) => p.name);
    const clesDeGroupes = [...new Set(gooey!.params.flatMap((p) => (p.colorGroup ? [p.colorGroup.key] : [])))];
    expect(clesDeGroupes).toContain("tint");
    expect(nomsDeParams).toContain("tint");

    // ET le test peut rougir : le schéma de clés NAÏF (nom brut d'un côté, clé
    // de groupe brute de l'autre) produit bien la collision sur cet effet.
    // Sans cette ligne, la garde ci-dessus passerait aussi sur un schéma qui ne
    // protège de rien.
    const naives = groupEffectParams(gooey!.params).map((item) =>
      item.kind === "single" ? item.param.name : item.key,
    );
    expect(naives.filter((c, i) => naives.indexOf(c) !== i)).toEqual(["tint"]);

    // Le schéma réel, lui, sépare les deux espaces de noms.
    const reelles = groupEffectParams(gooey!.params).map((item) => item.reactKey);
    expect(reelles).toContain("param:tint");
    expect(reelles).toContain("groupe:tint");
    expect(new Set(reelles).size).toBe(reelles.length);
  });

  it("place un en-tête spatial avant les paramètres sans les dupliquer", () => {
    const motion = effectRegistry.find((effect) => effect.id === "motionBlur")!;
    const items = groupEffectParams(motion.params, motion.canvasControls);
    const header = items.findIndex((item) => item.kind === "spatial-header" && item.id === "trajectory");
    const angle = items.findIndex((item) => item.kind === "single" && item.param.name === "angle");
    const amount = items.findIndex((item) => item.kind === "single" && item.param.name === "amount");
    expect(header).toBeGreaterThanOrEqual(0);
    expect(header).toBeLessThan(angle);
    expect(header).toBeLessThan(amount);
    expect(items.filter((item) => item.kind === "single" && ["angle", "amount"].includes(item.param.name))).toHaveLength(2);
    expect(items.filter((item) => item.kind === "spatial-header").map((item) => item.reactKey)).toEqual([
      "spatial:trajectory", "spatial:center",
    ]);
  });
});
