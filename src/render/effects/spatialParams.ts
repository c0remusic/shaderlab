import type { CanvasControl, EffectModule } from "./types";

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
 * oublié reste simplement modifiable sous un verrou censé le geler.
 *
 * DÉCLARATIF, jamais deviné au nom : la tentation de repérer `centreX`/`regionX`
 * par motif est la même que celle qu'`EffectModule.canvasControls` documente
 * avoir écartée — ça marche jusqu'au jour où un effet nomme autrement, et ça
 * échoue alors sans rien dire.
 */
export function spatialParamNames(controls: readonly CanvasControl[] | undefined): string[] {
  const noms: string[] = [];
  for (const control of controls ?? []) {
    switch (control.kind) {
      case "point":
        noms.push(control.x, control.y);
        break;
      case "disk":
        noms.push(control.x, control.y, control.radius);
        break;
      case "box":
        noms.push(control.x, control.y, control.width, control.height, control.rotation);
        break;
      case "axis":
        noms.push(control.angle, control.length);
        break;
    }
  }
  return noms;
}

/** Raccourci depuis un module d'effet. */
export function effectSpatialParams(effect: EffectModule | null | undefined): string[] {
  return spatialParamNames(effect?.canvasControls);
}
