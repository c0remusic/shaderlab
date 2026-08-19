import type { CanvasControl, EffectModule } from "./types";

/**
 * L'AXE D'UN PARAMÈTRE SPATIAL — de quel côté du cadre il se mesure, donc par
 * quel facteur sa fraction se lit en PIXELS de l'image.
 *
 * D'OÙ ÇA VIENT (voie B, tranchée le 2026-08-19,
 * `.scratch/hybride-lightroom-photoshop/issues/03-symetrie-panneau-toile.md`).
 * Le panneau montrait `largeur: 0.8` pendant que la toile se tirait en pixels :
 * un utilisateur qui vient de tirer une poignée ne lisait nulle part ce qu'il
 * avait fait dans une unité qu'il reconnaît. Le panneau passe donc en pixels à
 * l'AFFICHAGE et à la SAISIE — mais la fraction reste ce qui est STOCKÉ, ce qui
 * garde un preset indépendant de la définition de la photo.
 *
 * ⚠️ LE FACTEUR DOIT MATCHER LA TOILE, sinon la « symétrie » ment. Chaque axe
 * ci-dessous reprend exactement la convention du manipulateur correspondant
 * (`ui/canvasControls.ts`, `ui/regionHandles.ts`, `ui/boxControl.ts`) :
 *
 * - `x`   — position ou étendue horizontale, fraction de la LARGEUR : × W.
 *           (`pointToOverlay`, `boiteVersTransform` : `centreX * cadre.width`.)
 * - `y`   — position ou étendue verticale, fraction de la HAUTEUR : × H.
 * - `iso` — rayon d'un disque, en espace ISOTROPE : × sqrt(W·H).
 *           (`regionHandles` : « un rayon r vaut r * sqrt(W*H) pixels de
 *           l'image ».) Un disque reste un disque quel que soit le rapport
 *           d'aspect, ce qu'un facteur par axe casserait.
 *
 * CE QUI EST DÉLIBÉRÉMENT ABSENT :
 * - les ROTATIONS (`box.rotation`, `axis.angle`) — déjà en `degrees`, une unité
 *   qu'on ne convertit pas en pixels.
 * - la LONGUEUR d'un axe (`axis.length` : `amount` de `motionBlur`, `portee` de
 *   `lightLeak`). `axisToOverlay` traite la valeur comme des pixels-image BRUTS
 *   (facteur 1), ce qui colle pour `amount` (déclaré `none`, déjà en pixels) mais
 *   PAS pour `portee` (déclaré `percent`, « fraction du cadre ») : sa convention
 *   canvas et sa convention shader ne coïncident pas encore. Lui imposer un
 *   affichage pixel maintenant imprimerait un nombre plausible-mais-faux — le
 *   mode de panne que ce dépôt proscrit. On l'exclut, et il reste en pourcentage
 *   jusqu'à ce que sa convention soit réconciliée.
 *
 * DÉCLARATIF ET NON DEVINÉ AU NOM, même raison que `spatialParams.ts` : l'axe
 * vient de la STRUCTURE du `canvasControls` (quel champ porte le nom), jamais
 * d'un motif comme `*X`/`*Y`. Un effet qui nommerait autrement marcherait sans
 * toucher ici.
 */
export type SpatialAxis = "x" | "y" | "iso";

function axesFromControl(control: CanvasControl): Map<string, SpatialAxis> {
  const axes = new Map<string, SpatialAxis>();
  switch (control.kind) {
    case "point":
      axes.set(control.x, "x");
      axes.set(control.y, "y");
      break;
    case "disk":
      axes.set(control.x, "x");
      axes.set(control.y, "y");
      axes.set(control.radius, "iso");
      break;
    case "box":
      axes.set(control.x, "x");
      axes.set(control.y, "y");
      axes.set(control.width, "x");
      axes.set(control.height, "y");
      break;
    case "axis":
      // angle : degrés ; length : pixels bruts côté toile — voir l'en-tête.
      break;
  }
  return axes;
}

/**
 * Pour un effet, l'axe pixel de chacun de ses paramètres spatiaux qui se lit en
 * pixels — ceux dont un `canvasControls` porte le nom en position/étendue/rayon
 * ET qui sont déclarés en `percent`. Les autres paramètres n'y sont pas : le
 * panneau les rend inchangés.
 *
 * ⚠️ Le filtre `unit === "percent"` n'est pas décoratif : un paramètre spatial
 * déclaré autrement (un `axis.length` en `none`) n'a pas de lecture pixel par
 * fraction, et l'inclure imprimerait un faux. `validateEffect` garantit que le
 * nom existe, ce filtre garantit qu'il porte bien une fraction.
 */
export function spatialPixelAxes(effect: EffectModule | null | undefined): Map<string, SpatialAxis> {
  const result = new Map<string, SpatialAxis>();
  if (!effect) return result;
  const unitByName = new Map(effect.params.map((param) => [param.name, param.unit]));
  for (const control of effect.canvasControls ?? []) {
    for (const [name, axis] of axesFromControl(control)) {
      if (unitByName.get(name) === "percent") result.set(name, axis);
    }
  }
  return result;
}

/**
 * Pixels de l'image par unité de fraction, pour un axe et une taille de cadre
 * donnés. La lecture inverse (pixels saisis → fraction stockée) est la division
 * par ce même facteur.
 */
export function pixelFactorForAxis(axis: SpatialAxis, imageSize: { width: number; height: number }): number {
  switch (axis) {
    case "x":
      return imageSize.width;
    case "y":
      return imageSize.height;
    case "iso":
      return Math.sqrt(imageSize.width * imageSize.height);
  }
}
