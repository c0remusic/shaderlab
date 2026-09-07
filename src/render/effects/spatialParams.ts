import { conditionRemplie } from "./displayCondition";
import type { CanvasControl, EffectModule } from "./types";

/**
 * Le RÔLE d'un champ de `CanvasControl` — ce que MESURE le paramètre dont ce
 * champ porte le nom. C'est la seule chose qui distingue les champs d'un genre
 * les uns des autres, et elle ne se devine pas au nom du paramètre.
 *
 * - `x` / `y` — POSITION sur un axe du cadre : fraction de sa LARGEUR (`x`), de
 *   sa HAUTEUR (`y`).
 * - `extentX` / `extentY` — ÉTENDUE sur le même axe, dans la même unité, mais
 *   ce n'est pas la même chose et les confondre a un coût précis. Ces deux rôles
 *   ont vécu sous `x`/`y` jusqu'au 2026-08-26, où le premier consommateur qui
 *   devait les distinguer est arrivé : `ui/effectMove.ts` TRANSLATE un effet, et
 *   une translation déplace un centre sans toucher à une largeur. Sous l'ancien
 *   vocabulaire, tirer sur un `aplat` l'aurait AGRANDI au lieu de le déplacer.
 *   Ce qui les rapproche — l'axe du cadre dont ils tirent leur facteur pixel —
 *   reste dérivable (`spatialPixels.axeDuRole`), donc rien n'est perdu.
 * - `iso`     — rayon d'un disque, mesuré en espace ISOTROPE. Un disque reste un
 *   disque quel que soit le rapport d'aspect, ce qu'un facteur par axe casserait.
 * - `degrees` — un angle (`box.rotation`, `axis.angle`), déjà dans une unité qui
 *   ne se convertit pas.
 * - `length`  — la longueur d'un axe (`axis.length`), dont la convention est
 *   propre à l'effet qui la déclare — voir `spatialPixels.ts`, qui l'exclut de
 *   la lecture en pixels pour cette raison.
 */
export type SpatialFieldRole = "x" | "y" | "extentX" | "extentY" | "iso" | "degrees" | "length";

/**
 * LA TABLE — les champs de chaque genre de `CanvasControl`, chacun avec son
 * rôle, dans l'ordre de déclaration du genre.
 *
 * ⚠️ **C'est la SEULE énumération des champs par genre, et c'est délibéré.** Tout
 * ce qui a besoin de savoir quels paramètres un contrôle de toile cite — et à
 * quel titre — en dérive : `spatialParamNames` ci-dessous, les facteurs pixel de
 * `spatialPixels.ts`, le regroupement atomique de `ParamPanel`, la translation
 * de `ui/effectMove.ts`. Recopier la liste garantissait qu'un cinquième genre en
 * oublierait un champ quelque part, silencieusement.
 *
 * DÉCLARATIF, jamais deviné au nom : la tentation de repérer `centreX`/`regionX`
 * par motif est la même que celle qu'`EffectModule.canvasControls` documente
 * avoir écartée — ça marche jusqu'au jour où un effet nomme autrement, et ça
 * échoue alors sans rien dire.
 */
export function controlFieldRoles(control: CanvasControl): Array<[name: string, role: SpatialFieldRole]> {
  switch (control.kind) {
    case "point":
      return [[control.x, "x"], [control.y, "y"]];
    case "disk":
      return [[control.x, "x"], [control.y, "y"], [control.radius, "iso"]];
    case "box":
      return [[control.x, "x"], [control.y, "y"], [control.width, "extentX"], [control.height, "extentY"], [control.rotation, "degrees"]];
    case "axis":
      return [[control.angle, "degrees"], [control.length, "length"]];
  }
}

/**
 * Les paramètres qu'un effet manipule SUR LA TOILE — ceux qu'un `canvasControls`
 * cite, et rien d'autre.
 *
 * C'est la définition de « la géométrie » pour le verrou de POSITION
 * (`layers/layerLocks.ts`) : ce verrou ne gèle pas des paramètres choisis à la
 * main, il gèle exactement ce qui se tire à la souris. Les deux listes ne
 * peuvent donc pas diverger — un contrôle de toile ajouté à un effet entre
 * automatiquement sous le verrou.
 *
 * ⚠️ **UNE seule définition, et c'est délibéré.** Trois appelants en ont besoin :
 * `App` (pour armer `LayerStack.updateParams` et `replaceLiveLayers`), et
 * `ParamPanel` (pour éteindre les bons curseurs). Recopier la liste des champs
 * de chaque genre de `CanvasControl` à trois endroits garantissait qu'un
 * cinquième genre en oublierait un — silencieusement, puisqu'un paramètre
 * oublié reste simplement modifiable sous un verrou censé le geler. D'où la
 * dérivation depuis `controlFieldRoles` : les noms sont ceux de la table, dans
 * son ordre, et rien ne se recopie.
 */
export function spatialParamNames(controls: readonly CanvasControl[] | undefined): string[] {
  const noms: string[] = [];
  for (const control of controls ?? []) {
    for (const [nom] of controlFieldRoles(control)) noms.push(nom);
  }
  return noms;
}

/** Raccourci depuis un module d'effet. */
export function effectSpatialParams(effect: EffectModule | null | undefined): string[] {
  return spatialParamNames(effect?.canvasControls);
}

/**
 * L'ANCRE de la déformation d'un `effectTransform` (ticket 24), en FRACTIONS du
 * cadre : la POSITION de l'effet quand il en a une, le centre de toile sinon.
 *
 * C'est le point FIXE de l'étirement — `uvT = (uv - ancre) * inv + ancre`. Le
 * cadrage l'a tranché : le scale déforme le repère de l'effet AUTOUR de sa
 * position (ticket 20), il ne la réécrit pas. La position se lit sur les rôles
 * `x`/`y` de `controlFieldRoles`, seule énumération du dépôt — jamais devinée au
 * nom.
 *
 * MÊME RÉSOLUTION QUE `ui/effectMove.ts` : valeur du calque, sinon défaut du
 * paramètre, et un contrôle dont le `visibleWhen` n'est pas rempli est SAUTÉ —
 * ancrer sur un point que l'utilisateur ne voit pas déformerait autour d'un lieu
 * invisible. On prend le PREMIER `x` et le PREMIER `y` visibles ; un axe seul
 * (`motionBlur` directionnel) n'a ni l'un ni l'autre, d'où le repli au centre.
 *
 * Pur, sans dépendance render/ui : appelé par `EffectPassRunner` pour remplir
 * l'uniform du binding 8.
 */
export function resolveEffectAnchor(
  effect: Pick<EffectModule, "canvasControls" | "params">,
  values: Readonly<Record<string, number>>,
): { x: number; y: number } {
  const controls = effect.canvasControls;
  if (!controls?.length) return { x: 0.5, y: 0.5 };
  const resolues: Record<string, number> = {};
  for (const param of effect.params) resolues[param.name] = values[param.name] ?? param.default;
  let x: number | null = null;
  let y: number | null = null;
  for (const control of controls) {
    if (control.visibleWhen && !conditionRemplie(control.visibleWhen, resolues)) continue;
    for (const [nom, role] of controlFieldRoles(control)) {
      if (role === "x" && x === null) x = resolues[nom] ?? 0.5;
      else if (role === "y" && y === null) y = resolues[nom] ?? 0.5;
    }
  }
  return { x: x ?? 0.5, y: y ?? 0.5 };
}
