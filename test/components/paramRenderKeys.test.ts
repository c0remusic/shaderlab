import { describe, it, expect } from "vitest";
import { groupEffectParams, type ParamRenderItem } from "../../src/components/ParamPanel";
import { effectRegistry } from "../../src/render/effects/registry";
import type { CanvasControl, EffectParam, EffectSection } from "../../src/render/effects/types";

/** `groupEffectParams` rend des BLOCS depuis le 2026-08-05 ; ce fichier
 *  interroge les items. Aplatir ICI et pas dans la fonction : c'est le
 *  découpage en blocs qui est la nouveauté, et un test qui lirait les clés des
 *  blocs au lieu de celles des items serait vert sans rien mesurer (un effet
 *  sans section rend UN bloc, donc une seule clé, donc jamais de doublon). */
function itemsDe(
  params: EffectParam[],
  controls?: readonly CanvasControl[],
  excluded?: Set<string>,
  options?: { sections?: readonly EffectSection[]; values?: Record<string, number> },
): ParamRenderItem[] {
  return groupEffectParams(params, controls, excluded, options).flatMap((bloc) => bloc.items);
}

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
      const cles = itemsDe(effect.params, effect.canvasControls, contrôlés, { sections: effect.sections }).map((item) => item.reactKey);
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
    const naives = itemsDe(gooey!.params).map((item) =>
      item.kind === "single" ? item.param.name : item.key,
    );
    expect(naives.filter((c, i) => naives.indexOf(c) !== i)).toEqual(["tint"]);

    // Le schéma réel, lui, sépare les deux espaces de noms.
    const reelles = itemsDe(gooey!.params).map((item) => item.reactKey);
    expect(reelles).toContain("param:tint");
    expect(reelles).toContain("groupe:tint");
    expect(new Set(reelles).size).toBe(reelles.length);
  });

  it("place un en-tête spatial avant les paramètres sans les dupliquer", () => {
    const motion = effectRegistry.find((effect) => effect.id === "motionBlur")!;
    // Trajectoire par défaut = Directionnel.
    const items = itemsDe(motion.params, motion.canvasControls);
    const header = items.findIndex((item) => item.kind === "spatial-header" && item.id === "trajectory");
    const angle = items.findIndex((item) => item.kind === "single" && item.param.name === "angle");
    const amount = items.findIndex((item) => item.kind === "single" && item.param.name === "amount");
    expect(header).toBeGreaterThanOrEqual(0);
    expect(header).toBeLessThan(angle);
    expect(header).toBeLessThan(amount);
    expect(items.filter((item) => item.kind === "single" && ["angle", "amount"].includes(item.param.name))).toHaveLength(2);
  });

  it("n'annonce sur la toile que le manipulateur du mode courant", () => {
    // Le filtrage de `visibleWhen` a DÉMÉNAGÉ le 2026-08-05 : il vivait dans le
    // JSX, il est maintenant dans `groupEffectParams` — même rendu, mais la
    // fonction ne renvoie plus les en-têtes qu'elle-même juge invisibles.
    // `motionBlur` est le cas qui l'exerce : ses deux contrôles s'excluent, donc
    // exactement un en-tête doit paraître dans chacun de ses trois modes.
    const motion = effectRegistry.find((effect) => effect.id === "motionBlur")!;
    const entetes = (trajectory: number) =>
      itemsDe(motion.params, motion.canvasControls, undefined, { values: { trajectory } })
        .filter((item) => item.kind === "spatial-header")
        .map((item) => item.reactKey);
    expect(entetes(0)).toEqual(["spatial:trajectory"]);
    expect(entetes(1)).toEqual(["spatial:center"]);
    expect(entetes(2)).toEqual(["spatial:center"]);
  });
});
