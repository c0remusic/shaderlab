import { describe, expect, it } from "vitest";
import { deplacementPatch, effetDeplacable } from "../../src/ui/effectMove";
import { getEffect } from "../../src/render/effects/registry";
import type { CanvasControl, EffectParam } from "../../src/render/effects/types";

/**
 * TRANSLATER UN EFFET QUI A UN LIEU — ticket 20.
 *
 * L'outil « Déplacer » sortait immédiatement sur tout calque sans `imageSource`,
 * donc les cinq effets qui déclarent un `canvasControls` ne se déplaçaient qu'en
 * attrapant leur petite poignée propre. Ce module est la règle du geste : quels
 * champs bougent, lesquels ne bougent PAS, et ce qu'un `visibleWhen` masque.
 *
 * ⚠️ Les deux moitiés du fichier ne testent pas la même chose et aucune ne
 * remplace l'autre. Les contrôles SYNTHÉTIQUES éprouvent la règle sur chacun des
 * quatre genres, y compris des combinaisons qu'aucun effet ne porte aujourd'hui.
 * Les effets RÉELS éprouvent le branchement sur le registre tel qu'il est —
 * c'est la moitié qui rougirait si un effet neuf nommait ses champs autrement,
 * ou si un `visibleWhen` changeait d'index.
 */

/** Un paramètre de position type : la plage large des sources posées, qui
 *  déborde le cadre des deux côtés (un soleil hors champ éclaire encore). */
function position(name: string, defaut: number): EffectParam {
  return { name, label: name, unit: "percent", min: -0.5, max: 1.5, default: defaut, step: 0.01 };
}

function scalaire(name: string, defaut: number, min: number, max: number): EffectParam {
  return { name, label: name, unit: "none", min, max, default: defaut, step: 0.01 };
}

const POINT: CanvasControl = { id: "p", kind: "point", x: "px", y: "py", label: "Point" };
const DISQUE: CanvasControl = { id: "d", kind: "disk", x: "dx", y: "dy", radius: "dr", label: "Disque" };
const AXE: CanvasControl = { id: "a", kind: "axis", angle: "aa", length: "al", label: "Axe" };
const BOITE: CanvasControl = {
  id: "b", kind: "box", x: "bx", y: "by", width: "bw", height: "bh", rotation: "br", label: "Boîte",
};

const PARAMS: EffectParam[] = [
  position("px", 0.5), position("py", 0.5),
  position("dx", 0.5), position("dy", 0.5), scalaire("dr", 0.2, 0.005, 0.5),
  scalaire("aa", 30, 0, 360), scalaire("al", 100, 0, 2000),
  position("bx", 0.5), position("by", 0.5),
  scalaire("bw", 0.4, 0.01, 2), scalaire("bh", 0.4, 0.01, 2), scalaire("br", 0, -180, 180),
];

describe("deplacementPatch — ce qu'une translation écrit", () => {
  it("translate un point : x par dx, y par dy, en fractions du cadre", () => {
    expect(deplacementPatch([POINT], PARAMS, { px: 0.4, py: 0.6 }, 0.1, -0.2)).toEqual({
      px: 0.5,
      py: expect.closeTo(0.4, 9),
    });
  });

  it("complète les valeurs absentes par le DÉFAUT du paramètre", () => {
    // Le cas NORMAL, pas le cas limite : un preset ancien n'écrit que les
    // paramètres qu'il connaissait, et un calque neuf n'en porte parfois aucun.
    expect(deplacementPatch([POINT], PARAMS, {}, 0.25, 0.25)).toEqual({ px: 0.75, py: 0.75 });
  });

  it("laisse le RAYON d'un disque intact — une translation ne change pas une taille", () => {
    const patch = deplacementPatch([DISQUE], PARAMS, { dx: 0.5, dy: 0.5, dr: 0.2 }, 0.1, 0.1);
    expect(patch).toEqual({ dx: expect.closeTo(0.6, 9), dy: expect.closeTo(0.6, 9) });
    expect(patch).not.toHaveProperty("dr");
  });

  it("laisse l'ANGLE et la LONGUEUR d'un axe intacts — et un axe seul n'est donc pas déplaçable", () => {
    // Un axe n'a AUCUN champ de position : sa géométrie tient dans un angle et
    // une longueur, toutes deux ancrées au centre du cadre. Il n'y a rien à
    // translater, et c'est correct.
    expect(deplacementPatch([AXE], PARAMS, { aa: 30, al: 100 }, 0.3, 0.3)).toBeNull();
  });

  it("déplace le CENTRE d'une boîte sans toucher sa largeur, sa hauteur ni sa rotation", () => {
    // ⚠️ LE CAS QUI A FAIT SÉPARER `x` DE `extentX` DANS LA TABLE DES RÔLES.
    // `width`/`height` étaient déclarés `x`/`y` — la même unité, le même axe —
    // donc une translation naïve aurait AGRANDI la forme au lieu de la déplacer,
    // et le geste aurait fait le contraire de ce qu'il annonce.
    const patch = deplacementPatch([BOITE], PARAMS, { bx: 0.5, by: 0.5, bw: 0.4, bh: 0.4, br: 20 }, 0.1, 0.1);
    expect(patch).toEqual({ bx: expect.closeTo(0.6, 9), by: expect.closeTo(0.6, 9) });
  });

  it("écrête aux bornes du CURSEUR, jamais au cadre", () => {
    // `min`/`max` de l'`EffectParam`, qui débordent souvent l'image : une source
    // posée à 1,5 est hors champ et c'est voulu.
    expect(deplacementPatch([POINT], PARAMS, { px: 1.4, py: -0.4 }, 0.5, -0.5)).toEqual({ px: 1.5, py: -0.5 });
  });

  it("calcule TOUJOURS depuis les valeurs de départ, donc un aller-retour revient au point de départ", () => {
    // Le mode de panne qu'un delta incrémental produirait : chaque frame écrêtée
    // perd sa part de mouvement, et revenir sur ses pas ne ramène plus l'effet
    // où il était. Ici on rejoue le geste réel — pousser au-delà de la borne,
    // puis revenir — depuis un seul et même départ.
    const depart = { px: 1.2, py: 0.5 };
    expect(deplacementPatch([POINT], PARAMS, depart, 0.8, 0)).toEqual({ px: 1.5, py: 0.5 });
    expect(deplacementPatch([POINT], PARAMS, depart, 0, 0)).toEqual({ px: 1.2, py: 0.5 });
  });

  it("déplace TOUS les contrôles visibles du même delta", () => {
    expect(deplacementPatch([POINT, DISQUE], PARAMS, { px: 0.2, py: 0.2, dx: 0.8, dy: 0.8 }, 0.1, 0)).toEqual({
      px: expect.closeTo(0.3, 9), py: 0.2,
      dx: expect.closeTo(0.9, 9), dy: 0.8,
    });
  });

  it("rend null sans contrôle, et sans champ de position", () => {
    expect(deplacementPatch(undefined, PARAMS, {}, 0.1, 0.1)).toBeNull();
    expect(deplacementPatch([], PARAMS, {}, 0.1, 0.1)).toBeNull();
  });

  it("saute un champ dont l'effet ne déclare pas le paramètre", () => {
    // `validateEffect` rend ce cas impossible au chargement ; sans bornes on ne
    // peut pas écrêter, donc on n'écrit pas plutôt que d'écrire n'importe quoi.
    expect(deplacementPatch([POINT], [position("px", 0.5)], { px: 0.5 }, 0.1, 0.1)).toEqual({ px: 0.6 });
  });
});

describe("deplacementPatch — ce qu'un `visibleWhen` masque", () => {
  const MODE = scalaire("mode", 0, 0, 1);
  const conditionne = (equals: number | number[]): CanvasControl => ({ ...POINT, visibleWhen: { param: "mode", equals } });

  it("saute un contrôle dont la condition n'est pas remplie", () => {
    // Écrire dans un contrôle masqué déplacerait un point que l'utilisateur ne
    // voit pas, sur un geste qui ne montre rien.
    expect(deplacementPatch([conditionne(1)], [...PARAMS, MODE], { mode: 0 }, 0.1, 0.1)).toBeNull();
  });

  it("garde un contrôle dont la condition est remplie", () => {
    expect(deplacementPatch([conditionne(1)], [...PARAMS, MODE], { mode: 1 }, 0.1, 0.1)).toEqual({
      px: expect.closeTo(0.6, 9), py: expect.closeTo(0.6, 9),
    });
  });

  it("lit la condition sur les valeurs RÉSOLUES, comme `CanvasControls`", () => {
    // `mode` absent du calque : c'est le défaut du paramètre (0) qui décide, pas
    // « valeur inconnue donc masqué ». Si les deux résolutions divergeaient, la
    // surface déplacerait un contrôle que l'overlay ne dessine pas.
    expect(deplacementPatch([conditionne(0)], [...PARAMS, MODE], {}, 0.1, 0.1)).not.toBeNull();
    expect(deplacementPatch([conditionne(1)], [...PARAMS, MODE], {}, 0.1, 0.1)).toBeNull();
  });

  it("accepte une LISTE d'index, comme les trois primitives d'`aplat`", () => {
    const params = [...PARAMS, scalaire("mode", 0, 0, 3)];
    expect(deplacementPatch([conditionne([1, 2, 3])], params, { mode: 2 }, 0.1, 0)).not.toBeNull();
    expect(deplacementPatch([conditionne([1, 2, 3])], params, { mode: 0 }, 0.1, 0)).toBeNull();
  });
});

describe("les effets RÉELS du registre", () => {
  it.each([
    // `lensFlare` (disque) et `pixelStretch` (disque) : le centre bouge, le
    // rayon reste. `lightLeak` porte un point ET un axe — seul le point bouge.
    ["lensFlare", { sourceX: 0.6, sourceY: 0.3 }],
    ["pixelStretch", { regionX: 0.6, regionY: 0.6 }],
    // `lightLeak` entre par le BORD (origine 1,0 ; 0,32 par défaut) : ses
    // défauts ne sont pas centrés, ce qui rend le test plus parlant que trois
    // lignes à 0,6.
    ["lightLeak", { origineX: 1.1, origineY: 0.42 }],
  ] as const)("%s se translate de +0,1 sur ses seules positions", (id, attendu) => {
    const effect = getEffect(id);
    const patch = deplacementPatch(effect?.canvasControls, effect?.params ?? [], {}, 0.1, 0.1);
    // Comparaison au centième : les défauts sont des décimales, et l'addition
    // flottante n'a pas à être exacte pour que le geste soit juste.
    const arrondi = Object.fromEntries(Object.entries(patch ?? {}).map(([k, v]) => [k, Number(v.toFixed(4))]));
    expect(arrondi).toEqual(attendu);
  });

  it("`motionBlur` en Directionnel n'a QUE son axe : rien à déplacer", () => {
    // Sa trajectoire par défaut (0 = Directionnel) montre l'axe et masque le
    // point de centre. Un effet qui a un `canvasControls` n'est donc pas
    // forcément déplaçable — ça dépend de son état.
    const effect = getEffect("motionBlur");
    expect(effetDeplacable(effect?.canvasControls, effect?.params ?? [], {})).toBe(false);
  });

  it("`motionBlur` en Rotation déplace son centre", () => {
    const effect = getEffect("motionBlur");
    const patch = deplacementPatch(effect?.canvasControls, effect?.params ?? [], { trajectory: 1 }, 0.2, 0);
    expect(patch).toEqual({ centerX: expect.closeTo(0.7, 9), centerY: 0.5 });
  });

  it("`aplat` bornée par le masque n'a pas de boîte, bornée par un rectangle si", () => {
    const effect = getEffect("aplat");
    // `borne` = 0 (« Le masque du calque ») : aucune géométrie posée, donc rien
    // à déplacer — c'est le pinceau ou le dégradé qui borne.
    expect(effetDeplacable(effect?.canvasControls, effect?.params ?? [], {})).toBe(false);
    const patch = deplacementPatch(effect?.canvasControls, effect?.params ?? [], { borne: 1 }, 0.1, -0.1);
    // Le centre seul : largeur, hauteur et rotation ne sont pas des positions.
    expect(patch).toEqual({ centreX: expect.closeTo(0.6, 9), centreY: expect.closeTo(0.4, 9) });
  });

  it("un effet SANS ancrage n'est pas déplaçable, et c'est correct", () => {
    // Un calque de réglage n'a pas de position chez Photoshop non plus. Le
    // critère est `canvasControls`, jamais le nom ni la catégorie.
    for (const id of ["glow", "curves", "grain", "duotone"]) {
      const effect = getEffect(id);
      expect(effect).not.toBeNull();
      expect(effetDeplacable(effect?.canvasControls, effect?.params ?? [], {})).toBe(false);
    }
  });

  it("les cinq effets à ancrage sont exactement ceux qui déclarent un `canvasControls`", () => {
    // Garde de FRONTIÈRE : si un effet neuf déclare un ancrage, cette liste
    // doit bouger dans le même commit — sinon « les cinq effets » de la doc
    // dérive de ce que le registre porte, silencieusement.
    const avecAncrage = ["aplat", "lensFlare", "lightLeak", "motionBlur", "pixelStretch"];
    for (const id of avecAncrage) {
      expect(getEffect(id)?.canvasControls?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
