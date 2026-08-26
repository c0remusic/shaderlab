import type { EffectModule } from "./types";
import { controlFieldRoles, type SpatialFieldRole } from "./spatialParams";
import { parseTypedNumber, snapToControlRange } from "../../ui/formatValue";

/**
 * LIRE UN PARAMÈTRE SPATIAL EN PIXELS — de quel côté du cadre il se mesure, donc
 * par quel facteur sa fraction se lit en PIXELS de l'image.
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
 * DÉCLARATIF ET NON DEVINÉ AU NOM, même raison que `spatialParams.ts` : l'axe
 * vient du RÔLE que la table de `controlFieldRoles` donne au champ, jamais d'un
 * motif comme `*X`/`*Y`. Un effet qui nommerait autrement marcherait sans
 * toucher ici.
 */
type SpatialAxis = "x" | "y" | "iso";

/**
 * Le rôle d'un champ, quand il se lit en pixels — et `null` sinon.
 *
 * CE QUI EST DÉLIBÉRÉMENT ABSENT :
 * - les ROTATIONS (rôle `degrees` : `box.rotation`, `axis.angle`) — déjà en
 *   degrés, une unité qu'on ne convertit pas en pixels.
 * - la LONGUEUR d'un axe (rôle `length` : `amount` de `motionBlur`, `portee` de
 *   `lightLeak`). `axisToOverlay` traite la valeur comme des pixels-image BRUTS
 *   (facteur 1), ce qui colle pour `amount` (déclaré `none`, déjà en pixels) mais
 *   PAS pour `portee` (déclaré `percent`, « fraction du cadre ») : sa convention
 *   canvas et sa convention shader ne coïncident pas encore. Lui imposer un
 *   affichage pixel maintenant imprimerait un nombre plausible-mais-faux — le
 *   mode de panne que ce dépôt proscrit. On l'exclut, et il reste en pourcentage
 *   jusqu'à ce que sa convention soit réconciliée.
 */
function axeDuRole(role: SpatialFieldRole): SpatialAxis | null {
  switch (role) {
    case "x":
    case "y":
    case "iso":
      return role;
    // UNE ÉTENDUE SE LIT SUR LE MÊME AXE QUE LA POSITION QUI LA PORTE : la
    // largeur d'une boîte est une fraction de la LARGEUR du cadre, exactement
    // comme son centre. Les deux rôles ont été séparés pour la translation
    // (`ui/effectMove.ts`), qui doit bouger l'un sans toucher l'autre ; ici la
    // distinction n'existe pas, et ces deux lignes sont ce qui l'annule.
    case "extentX":
      return "x";
    case "extentY":
      return "y";
    default:
      return null;
  }
}

/**
 * Pixels de l'image par unité de fraction, pour un axe et une taille de cadre
 * donnés. La lecture inverse (pixels saisis → fraction stockée) est la division
 * par ce même facteur.
 */
function pixelFactorForAxis(axis: SpatialAxis, imageSize: { width: number; height: number }): number {
  switch (axis) {
    case "x":
      return imageSize.width;
    case "y":
      return imageSize.height;
    case "iso":
      return Math.sqrt(imageSize.width * imageSize.height);
  }
}

/**
 * Pour un effet et un cadre, le facteur « fraction → pixels » de chacun de ses
 * paramètres spatiaux qui se lit en pixels — ceux dont un `canvasControls` porte
 * le nom en position/étendue/rayon ET qui sont déclarés en `percent`. Les autres
 * paramètres n'y sont pas : le panneau les rend inchangés.
 *
 * ⚠️ Le filtre `unit === "percent"` n'est pas décoratif : un paramètre spatial
 * déclaré autrement (un `axis.length` en `none`) n'a pas de lecture pixel par
 * fraction, et l'inclure imprimerait un faux. `validateEffect` garantit que le
 * nom existe, ce filtre garantit qu'il porte bien une fraction.
 *
 * Cadre absent ou dégénéré (`{0,0}` = aucun document) et effet sans contrôle de
 * toile rendent une map VIDE, et la rendent AVANT de parcourir `params` : 22
 * effets sur 27 n'ont aucun contrôle, et le panneau se re-rend à chaque frame de
 * glissement.
 */
export function spatialPixelFactors(
  effect: EffectModule | null | undefined,
  imageSize: { width: number; height: number } | null | undefined,
): Map<string, number> {
  const facteurs = new Map<string, number>();
  if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) return facteurs;
  if (!effect?.canvasControls?.length) return facteurs;

  const unitByName = new Map(effect.params.map((param) => [param.name, param.unit]));
  for (const control of effect.canvasControls) {
    for (const [name, role] of controlFieldRoles(control)) {
      const axe = axeDuRole(role);
      if (axe === null || unitByName.get(name) !== "percent") continue;
      facteurs.set(name, pixelFactorForAxis(axe, imageSize));
    }
  }
  return facteurs;
}

/**
 * Lecture INVERSE d'une saisie en pixels : le nombre tapé est ramené en fraction
 * par le facteur, puis borné aux bornes du CURSEUR et calé sur son pas.
 *
 * Les bornes sont celles du curseur, pas celles du cadre : elles peuvent sortir
 * de l'image — `sourceX` va de −0,5 à 1,5 — donc la saisie en pixels le peut
 * aussi, ce qui est voulu.
 *
 * ⚠️ Le bornage passe par `snapToControlRange` en espace FRACTION, jamais en
 * espace pixel : `min·F` et `step·F` ne sont pas entiers en général, et un
 * arrondi à l'échelle pixel tomberait d'un demi-pas à côté. C'est aussi ce qui
 * donne à ce chemin la même normalisation décimale que tous les autres champs de
 * saisie du panneau.
 */
export function parsePixelInput(
  raw: string,
  facteur: number,
  bornes: { min: number; max: number; step: number },
): number | null {
  const px = parseTypedNumber(raw);
  return px === null ? null : snapToControlRange(px / facteur, bornes.min, bornes.max, bornes.step);
}
